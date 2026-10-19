import type { WorkOrderStatus } from '../../../../shared'
import type { JobHandlerScope, JobQueue, Logger, QueuedJob, TenantContext, TenantTransaction } from '../../../core/index'
import type { InvitationMail } from '../../tenancy'
import type { InvitationCurrentFacts } from '../domain/current'
import { z } from 'zod'
import { ResendTransportError } from '../../tenancy'
import { invitationIsCurrent, workOrderIsCurrent } from '../domain/current'
import { mailIdempotencyKey } from '../domain/idempotency-key'
import { retryDelayMs } from '../domain/retry'

/** One queue for every outbox retry. The envelope carries the Tenant, not this name. */
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

/** The row columns every kind shares. */
interface OutboxEntryState {
  readonly entryId: string
  readonly state: 'pending' | 'sent' | 'failed' | 'stale'
  readonly attemptCount: number
  readonly nextAttemptAt: Date | null
}

/**
 * One work order as the attempt reads it.
 * The message is already composed from the current rows.
 * For "no longer yours" that composition used the entry's vehicle id.
 */
export interface LoadedWorkOrderEntry extends OutboxEntryState {
  readonly kind: 'work_order'
  readonly status: WorkOrderStatus
  readonly driverId: string
  /** `done` or `no-show`. A cancelled Ride is `rideCancelled`, not this. */
  readonly rideFinished: boolean
  readonly rideCancelled: boolean
  /** A newer work order for the same Ride and the same Driver. */
  readonly superseded: boolean
  readonly email: string | null
  readonly message: OutboxMessage | null
}

/**
 * One invitation as the attempt reads it, composed from the invitation
 * (email, role), the Tenant name, and the Tenant default locale.
 * The id stays inside `mail.inviteUrl`, which the mailer posts and never logs.
 */
export interface LoadedInvitationEntry extends OutboxEntryState {
  readonly kind: 'invitation'
  /** Null when this Tenant has no such invitation. */
  readonly invitation: InvitationCurrentFacts | null
  /** Null when the mail cannot be built, for example a role outside the Tenant roles. */
  readonly mail: InvitationMail | null
  /** What the mailer will compose from `mail`. Only the idempotency key reads it. */
  readonly message: OutboxMessage | null
}

export type LoadedOutboxEntry = LoadedWorkOrderEntry | LoadedInvitationEntry

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

/** The two mails the outbox carries. The fake, console, and Resend mailers all fit. */
export interface OutboxSender {
  sendWorkOrder: (mail: OutboxMessage & { readonly to: string, readonly idempotencyKey?: string }) => Promise<void>
  sendInvitation: (mail: InvitationMail) => Promise<void>
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
 * Whether this mail still matters (ADR-0045). A work order follows the
 * Ride and the Driver. An invitation is current while it is pending.
 */
export function entryIsCurrent(entry: LoadedOutboxEntry, now: Date): boolean {
  if (entry.kind === 'invitation')
    return invitationIsCurrent(entry.invitation, now)
  return workOrderIsCurrent({
    status: entry.status,
    rideFinished: entry.rideFinished,
    rideCancelled: entry.rideCancelled,
    superseded: entry.superseded,
  })
}

/**
 * One send. False for a blank address, a mail that cannot be built, or a
 * provider rejection. The key is the entry id plus a hash of what is posted.
 * The Resend-in-test error is the exception: that process must stop.
 */
export async function sendEntry(entry: LoadedOutboxEntry, mailer: OutboxSender): Promise<boolean> {
  try {
    if (entry.kind === 'invitation') {
      if (entry.mail === null || entry.message === null)
        return false
      await mailer.sendInvitation({
        ...entry.mail,
        idempotencyKey: mailIdempotencyKey(entry.entryId, entry.message, entry.mail.to),
      })
      return true
    }
    const address = entry.email?.trim() ?? ''
    if (address === '' || entry.message === null)
      return false
    await mailer.sendWorkOrder({
      to: address,
      ...entry.message,
      idempotencyKey: mailIdempotencyKey(entry.entryId, entry.message, address),
    })
    return true
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    return false
  }
}

/**
 * The row, or the row a failed composition still carries. Anything else
 * propagates: there is no row in hand to count against.
 */
async function loadForAttempt(store: OutboxAttemptStore, entryId: string): Promise<LoadedOutboxEntry | null> {
  try {
    return await store.load(entryId)
  }
  catch (error) {
    if (error instanceof OutboxComposeError)
      return error.entry
    throw error
  }
}

/**
 * One due attempt. The caller is the job handler, through `handleNext` or `work`.
 * A mail that no longer matters is not sent and becomes stale.
 * Replaced means a newer work order for the same Ride and the same Driver.
 * "No longer yours" stays current when the Ride is cancelled.
 * An invitation that is no longer pending is stale.
 * A blank address counts as a failed attempt. A provider rejection does too.
 * After the fourth failure the entry is failed and nothing further is queued.
 * The log line is the entry id. The request id is the one the queue restored.
 */
export async function attemptOutboxEntry(input: {
  readonly entryId: string
  readonly store: OutboxAttemptStore
  readonly mailer: OutboxSender
  readonly queue: JobQueue
  readonly context: TenantContext
  readonly transaction: TenantTransaction
  readonly now: Date
  readonly log: Logger
}): Promise<void> {
  let entry: LoadedOutboxEntry | null
  try {
    // A composition failure still counts below.
    entry = await loadForAttempt(input.store, input.entryId)
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    // A failure before the row is in hand has nothing to save, so pg-boss retries.
    input.log.warn({ event: 'mail_outbox.attempt_failed', entryId: input.entryId })
    throw error
  }
  if (!entry || entry.state !== 'pending')
    return
  if (entry.nextAttemptAt !== null && entry.nextAttemptAt.getTime() > input.now.getTime()) {
    // The worker took the job early. Put it back at the time the row already recorded.
    await enqueueMailOutboxJob(input.queue, input.context, input.transaction, entry.entryId, entry.nextAttemptAt)
    return
  }

  input.log.info({ event: 'mail_outbox.attempt', entryId: entry.entryId })

  if (!entryIsCurrent(entry, input.now)) {
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

  if (await sendEntry(entry, input.mailer)) {
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

/** What the caller waiting on the first attempt hears. `pending` is retried by the queued job. */
export type FirstAttemptOutcome = 'sent' | 'pending' | 'stale'

/**
 * The attempt an action waits for, right after the entry committed.
 * The job queued with the entry is the next attempt, so a failure keeps
 * that time and queues nothing. A mail that no longer matters is stale.
 * A row the queued job already settled reports that state.
 * The log line is the entry id.
 */
export async function firstOutboxAttempt(input: {
  readonly entryId: string
  readonly store: OutboxAttemptStore
  readonly mailer: OutboxSender
  readonly now: Date
  readonly log: Logger
}): Promise<FirstAttemptOutcome> {
  const entry = await loadForAttempt(input.store, input.entryId)
  // The entry committed just before this call. A missing row is a fixed error.
  if (!entry)
    throw new Error('Mail outbox read failed')
  if (entry.state === 'sent' || entry.state === 'stale')
    return entry.state
  if (entry.state !== 'pending')
    return 'pending'

  input.log.info({ event: 'mail_outbox.attempt', entryId: entry.entryId })

  if (!entryIsCurrent(entry, input.now)) {
    await input.store.save(entry.entryId, {
      state: 'stale',
      attemptCount: entry.attemptCount,
      nextAttemptAt: null,
    })
    return 'stale'
  }
  const sent = await sendEntry(entry, input.mailer)
  await input.store.save(entry.entryId, {
    state: sent ? 'sent' : 'pending',
    attemptCount: entry.attemptCount + 1,
    nextAttemptAt: sent ? null : entry.nextAttemptAt,
  })
  return sent ? 'sent' : 'pending'
}

/**
 * The job body. `data` is only the entry id. The Tenant and the request id
 * come from the envelope the queue already restored onto this session.
 */
export async function handleMailOutboxJob(
  job: QueuedJob,
  scope: JobHandlerScope,
  deps: {
    readonly mailer: OutboxSender
    readonly queue: JobQueue
    readonly log: Logger
    readonly now: () => Date
    readonly openStore: (transaction: TenantTransaction, context: TenantContext) => OutboxAttemptStore
  },
): Promise<void> {
  const parsed = jobData.parse(job.data)
  const context = { tenantId: job.tenantId }
  await attemptOutboxEntry({
    entryId: parsed.entryId,
    store: deps.openStore(scope.transaction, context),
    mailer: deps.mailer,
    queue: deps.queue,
    context,
    transaction: scope.transaction,
    now: deps.now(),
    log: deps.log,
  })
}
