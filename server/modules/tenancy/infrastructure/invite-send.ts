import type { DisplayLocale } from '../../../../shared'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The Better Auth send callback does not take a locale. The invite call
 * sets this for the duration of createInvitation, which awaits the send.
 */
export interface InviteSendState {
  locale: DisplayLocale
  emailSent: boolean
}

export const inviteSendState = new AsyncLocalStorage<InviteSendState>()
