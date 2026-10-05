import type { DisplayLocale } from '../../../../shared'
import type { Logger } from '../../../core/index'
import type { InvitationMail, Mailer } from './mailer'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getLogger } from '../../../core/index'
import { ResendTransportError } from './mailer'

/**
 * The Better Auth send callback does not take a locale. The invite call
 * sets this for the duration of createInvitation, which awaits the send.
 */
export interface InviteSendState {
  locale: DisplayLocale
  emailSent: boolean
}

export const inviteSendState = new AsyncLocalStorage<InviteSendState>()

/**
 * A failed send must not fail the invite. The admin still gets the
 * copyable link, and `emailSent` stays false so the UI can say so.
 * The Resend-in-test error is the exception: that process must exit.
 */
export async function deliverInvitationEmail(
  mailer: Mailer | undefined,
  mail: InvitationMail,
  log?: Logger,
): Promise<void> {
  if (mailer === undefined)
    return
  const pending = inviteSendState.getStore()
  try {
    await mailer.sendInvitation(mail)
    if (pending)
      pending.emailSent = true
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    const logger = log ?? getLogger()
    logger.warn({
      event: 'invite.email_failed',
      err: {
        type: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Invitation email was not sent.',
      },
    })
  }
}
