import type { Logger } from '../../../core/index'
import type { LoadedOutboxEntry } from './attempt'
import { z } from 'zod'
import { ResendTransportError } from '../../tenancy'
import { workOrderIsCurrent } from '../domain/current'
import { workOrderIdempotencyKey } from '../domain/idempotency-key'
import { OutboxComposeError } from './attempt'

/**
 * One immediate resend of a failed work order (ADR-0045).
 * `sent` left the failed list. `stale` was not sent because it no longer matters.
 * `failed` was tried and stays failed. `missing` is not a failed work order.
 * There is no next attempt: this does not start the 1, 5, 30 minute cycle.
 */
export type FailedMailResendOutcome = 'sent' | 'stale' | 'failed' | 'missing'

/** The row lock and the update share the caller's transaction. */
export interface FailedMailResendStore {
  load: (entryId: string) => Promise<LoadedOutboxEntry | null>
  /** `sent` or `stale` from `failed` only. The attempt count stays. */
  settle: (entryId: string, state: 'sent' | 'stale') => Promise<void>
}

interface WorkOrderSender {
  sendWorkOrder: (mail: {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
    readonly idempotencyKey?: string
  }) => Promise<void>
}

/**
 * One try of a failed work order, with the same current-ness rule as a retry.
 * Success and a mail that no longer matters both leave `failed`.
 * A rejection stays `failed` and queues nothing.
 * The log line is the entry id, the kind, and the outcome. No address and no body.
 */
export async function resendFailedWorkOrder(input: {
  readonly entryId: string
  readonly store: FailedMailResendStore
  readonly mailer: WorkOrderSender
  readonly log: Logger
}): Promise<FailedMailResendOutcome> {
  const entryId = z.uuid().parse(input.entryId)
  let entry: LoadedOutboxEntry | null
  try {
    entry = await input.store.load(entryId)
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    // The row was read and the mail could not be composed. Stay failed.
    // A failure before the row is in hand has nothing to decide, so it propagates.
    if (error instanceof OutboxComposeError) {
      if (error.entry.state !== 'failed')
        return 'missing'
      logResend(input.log, entryId, 'failed')
      return 'failed'
    }
    throw error
  }
  if (!entry || entry.state !== 'failed')
    return 'missing'

  const current = workOrderIsCurrent({
    status: entry.status,
    rideFinished: entry.rideFinished,
    rideCancelled: entry.rideCancelled,
    superseded: entry.superseded,
  })
  if (!current) {
    await input.store.settle(entry.entryId, 'stale')
    logResend(input.log, entry.entryId, 'stale')
    return 'stale'
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

  if (!sent) {
    // The count stays. A new cycle would queue another job, and the column stops at 4.
    logResend(input.log, entry.entryId, 'failed')
    return 'failed'
  }
  await input.store.settle(entry.entryId, 'sent')
  logResend(input.log, entry.entryId, 'sent')
  return 'sent'
}

function logResend(log: Logger, entryId: string, outcome: 'sent' | 'stale' | 'failed'): void {
  log.info({
    event: 'mail_outbox.resend',
    entryId,
    kind: 'work_order',
    outcome,
  })
}
