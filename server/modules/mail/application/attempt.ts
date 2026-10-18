import type { WorkOrderStatus } from '../../../../shared'
import type { JobHandlerScope, JobQueue, Logger, QueuedJob, TenantContext, TenantTransaction } from '../../../core/index'
import { z } from 'zod'
import { ResendTransportError } from '../../tenancy'
import { workOrderIsCurrent } from '../domain/current'
import { workOrderIdempotencyKey } from '../domain/idempotency-key'
import { retryDelayMs } from '../domain/retry'

/** One queue for every work-order retry. The envelope carries the Tenant, not this name. */
export const MAIL_OUTBOX_QUEUE = 'mail-outbox'

/** At most four sends. The check on the table is the same bound. */
const MAX_ATTEMPTS = 4

/**
 * The composed message. Null when the mail cannot be built
 * (no Vehicle left to name). The address is `email`, not inside the message.
 */
export interface OutboxMessage {
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * One pending work order as the attempt reads it.
 * The message is already composed from the current rows.
 * For "no longer yours" that composition used the entry's vehicle id.
 */
export interface LoadedOutboxEntry {
  readonly entryId: string
  readonly status: WorkOrderStatus
  readonly driverId: string
  /** `done` or `no-show`. A cancelled Ride is `rideCancelled`, not this. */
  readonly rideFinished: boolean
  readonly rideCancelled: boolean
  /** A newer work order for the same Ride was recorded after this entry. */
  readonly superseded: boolean
  readonly email: string | null
  readonly state: 'pending' | 'sent' | 'failed' | 'stale'
  readonly attemptCount: number
  readonly nextAttemptAt: Date | null
  readonly message: OutboxMessage | null
}

/**
 * The row was read, and composing the mail failed. The attempt can still
 * be counted. The message is fixed so a guest or a place cannot leave on it.
 */
export class OutboxComposeError extends Error {
  readonly entry: LoadedOutboxEntry

  constructor(entry: LoadedOutboxEntry) {
    super('Mail outbox read failed')
    this.name = 'OutboxComposeError'
    this.entry = entry
  }
}

export interface OutboxAttemptPatch {
  readonly state: 'pending' | 'sent' | 'failed' | 'stale'
  readonly attemptCount: number
  readonly nextAttemptAt: Date | null
}

/** The row lock and the update share the caller's transaction. */
export interface OutboxAttemptStore {
  load: (entryId: string) => Promise<LoadedOutboxEntry | null>
  save: (entryId: string, patch: OutboxAttemptPatch) => Promise<void>
}

interface WorkOrderSender {
  sendWorkOrder: (mail: OutboxMessage & { readonly to: string, readonly idempotencyKey?: string }) => Promise<void>
}

const jobData = z.object({
  entryId: z.uuid(),
})

/**
 * Put the next attempt on the queue inside `transaction`, due at `startAfter`.
 * A rollback of that transaction drops the job with the row change.
 */
export async function enqueueMailOutboxJob(
  queue: JobQueue,
  context: TenantContext,
  transaction: TenantTransaction,
  entryId: string,
  startAfter: Date,
): Promise<void> {
  await queue.enqueue(context, transaction, MAIL_OUTBOX_QUEUE, { entryId: z.uuid().parse(entryId) }, { startAfter })
}

/**
 * One due attempt. The caller is the job handler, through `handleNext` or `work`.
 * A mail that no longer matters is not sent and becomes stale.
 * A blank address counts as a failed attempt. A provider rejection does too.
 * After the fourth failure the entry is failed and nothing further is queued.
 * The log line is the entry id. The request id is the one the queue restored.
 */
export async function attemptOutboxEntry(input: {
  readonly entryId: string
  readonly store: OutboxAttemptStore
  readonly mailer: WorkOrderSender
  readonly queue: JobQueue
  readonly context: TenantContext
  readonly transaction: TenantTransaction
  readonly now: Date
  readonly log: Logger
}): Promise<void> {
  let entry: LoadedOutboxEntry | null
  try {
    entry = await input.store.load(input.entryId)
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    // The row was read and the mail could not be composed. Count it below.
    // A failure before the row is in hand has nothing to save, so pg-boss retries.
    if (error instanceof OutboxComposeError) {
      entry = error.entry
    }
    else {
      input.log.warn({ event: 'mail_outbox.attempt_failed', entryId: input.entryId })
      throw error
    }
  }
  if (!entry || entry.state !== 'pending')
    return
  if (entry.nextAttemptAt !== null && entry.nextAttemptAt.getTime() > input.now.getTime()) {
    // The worker took the job early. Put it back at the time the row already recorded.
    await enqueueMailOutboxJob(input.queue, input.context, input.transaction, entry.entryId, entry.nextAttemptAt)
    return
  }

  input.log.info({ event: 'mail_outbox.attempt', entryId: entry.entryId })

  const current = workOrderIsCurrent({
    status: entry.status,
    rideFinished: entry.rideFinished,
    rideCancelled: entry.rideCancelled,
    superseded: entry.superseded,
  })
  if (!current) {
    await input.store.save(entry.entryId, {
      state: 'stale',
      attemptCount: entry.attemptCount,
      nextAttemptAt: null,
    })
    return
  }

  if (entry.attemptCount >= MAX_ATTEMPTS) {
    await input.store.save(entry.entryId, {
      state: 'failed',
      attemptCount: entry.attemptCount,
      nextAttemptAt: null,
    })
    return
  }

  const address = entry.email?.trim() ?? ''
  let sent = false
  if (address !== '' && entry.message !== null) {
    try {
      await input.mailer.sendWorkOrder({
        to: address,
        ...entry.message,
        idempotencyKey: workOrderIdempotencyKey(entry.entryId, entry.message, address),
      })
      sent = true
    }
    catch (error) {
      // The test server must not keep a live Resend transport running.
      if (error instanceof ResendTransportError)
        throw error
    }
  }

  if (sent) {
    await input.store.save(entry.entryId, {
      state: 'sent',
      attemptCount: entry.attemptCount + 1,
      nextAttemptAt: null,
    })
    return
  }

  const attemptCount = entry.attemptCount + 1
  const delay = retryDelayMs(attemptCount)
  if (delay === null) {
    await input.store.save(entry.entryId, {
      state: 'failed',
      attemptCount,
      nextAttemptAt: null,
    })
    return
  }
  const nextAttemptAt = new Date(input.now.getTime() + delay)
  await input.store.save(entry.entryId, {
    state: 'pending',
    attemptCount,
    nextAttemptAt,
  })
  await enqueueMailOutboxJob(input.queue, input.context, input.transaction, entry.entryId, nextAttemptAt)
}

/**
 * The job body. `data` is only the entry id. The Tenant and the request id
 * come from the envelope the queue already restored onto this session.
 */
export async function handleMailOutboxJob(
  job: QueuedJob,
  scope: JobHandlerScope,
  deps: {
    readonly mailer: WorkOrderSender
    readonly queue: JobQueue
    readonly log: Logger
    readonly now: () => Date
    readonly openStore: (transaction: TenantTransaction) => OutboxAttemptStore
  },
): Promise<void> {
  const parsed = jobData.parse(job.data)
  await attemptOutboxEntry({
    entryId: parsed.entryId,
    store: deps.openStore(scope.transaction),
    mailer: deps.mailer,
    queue: deps.queue,
    context: { tenantId: job.tenantId },
    transaction: scope.transaction,
    now: deps.now(),
    log: deps.log,
  })
}
