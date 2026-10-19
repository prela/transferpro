import type { InvitationMailOutcome } from '../../../../shared'
import type { Logger } from '../../../core/index'
import type { FirstAttemptOutcome } from './attempt'
import { ResendTransportError } from '../../tenancy'

/**
 * The invite call's mail, after Better Auth has created the invitation
 * (ADR-0045). Better Auth writes on the auth pool and the entry lives on the
 * app pool, so they cannot share one transaction. `record` writes the entry
 * and its one-minute job on one tenant transaction. `attempt` is the first
 * send on another, and the invite call waits for it.
 *
 * The link is returned whatever happens here. An entry that cannot be
 * written is `not_sent`: nothing will retry it, so the Admin is told to hand
 * the link over. A first attempt that throws after the entry exists is
 * `retrying`, because the queued job tries again. Neither log line carries
 * the address or the invitation id.
 */
export async function deliverNewInvitation(input: {
  readonly record: () => Promise<string>
  readonly attempt: (entryId: string) => Promise<FirstAttemptOutcome>
  readonly log: Logger
}): Promise<InvitationMailOutcome> {
  let entryId: string
  try {
    entryId = await input.record()
  }
  catch {
    input.log.warn({ event: 'mail_outbox.invitation_not_recorded' })
    return 'not_sent'
  }
  try {
    const outcome = await input.attempt(entryId)
    return outcome === 'pending' ? 'retrying' : outcome
  }
  catch (error) {
    // The test server must not keep a live Resend transport running.
    if (error instanceof ResendTransportError)
      throw error
    input.log.warn({ event: 'mail_outbox.first_attempt_failed', entryId })
    return 'retrying'
  }
}
