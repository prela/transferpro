import type { Logger } from '../../../core/index'
import type { LoadedOutboxEntry, OutboxSender } from './attempt'
import { z } from 'zod'
import { ResendTransportError } from '../../tenancy'
import { entryIsCurrent, OutboxComposeError, sendEntry } from './attempt'

/**
 * One immediate resend of a failed mail (ADR-0045).
 * `sent` left the failed list. `stale` was not sent because it no longer matters.
 * `failed` was tried and stays failed. `missing` is not a failed mail.
 * There is no next attempt: this does not start the 1, 5, 30 minute cycle.
 */
export type FailedMailResendOutcome = 'sent' | 'stale' | 'failed' | 'missing'

/** The row lock and the update share the caller's transaction. */
export interface FailedMailResendStore {
  load: (entryId: string) => Promise<LoadedOutboxEntry | null>
  /** `sent` or `stale` from `failed` only. The attempt count stays. */
  settle: (entryId: string, state: 'sent' | 'stale') => Promise<void>
}

/**
 * One try of a failed work order or invitation, with the same current-ness
 * rule as a retry. Success and a mail that no longer matters both leave
 * `failed`. A rejection stays `failed` and queues nothing.
 * The log line is the entry id, the kind, and the outcome. No address,
 * no body, and no invitation id. The caller has already checked the role
 * for this kind.
 */
export async function resendFailedOutboxEntry(input: {
  readonly entryId: string
  readonly store: FailedMailResendStore
  readonly mailer: OutboxSender
  readonly log: Logger
  readonly now?: Date
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
      logResend(input.log, error.entry, 'failed')
      return 'failed'
    }
    throw error
  }
  if (!entry || entry.state !== 'failed')
    return 'missing'

  if (!entryIsCurrent(entry, input.now ?? new Date())) {
    await input.store.settle(entry.entryId, 'stale')
    logResend(input.log, entry, 'stale')
    return 'stale'
  }

  if (!await sendEntry(entry, input.mailer)) {
    // The count stays. A new cycle would queue another job, and the column stops at 4.
    logResend(input.log, entry, 'failed')
    return 'failed'
  }
  await input.store.settle(entry.entryId, 'sent')
  logResend(input.log, entry, 'sent')
  return 'sent'
}

function logResend(log: Logger, entry: LoadedOutboxEntry, outcome: 'sent' | 'stale' | 'failed'): void {
  log.info({
    event: 'mail_outbox.resend',
    entryId: entry.entryId,
    kind: entry.kind,
    outcome,
  })
}
