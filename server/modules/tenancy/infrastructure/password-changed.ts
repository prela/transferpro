import type { DisplayLocale } from '../../../../shared'
import type { Logger } from '../../../core/index'
import type { Mailer } from './mailer'

/**
 * A password is already saved when this runs. The mail is the only signal
 * that someone else took the account, so a failed send must not undo the
 * change and the request does not wait for it. Both lines carry userId only.
 */
export function noticePasswordChanged(
  mailer: Mailer | undefined,
  logger: Logger,
  userId: string,
  mail: { readonly to: string, readonly locale: DisplayLocale } | null,
): void {
  logger.info({ event: 'auth.password_changed', userId })
  if (mailer === undefined || mail === null) {
    logger.warn({ event: 'mail.password_changed', outcome: 'send_failed', userId })
    return
  }
  // Not awaited. The change response is already decided.
  void mailer.sendPasswordChanged(mail).then(() => {
    logger.info({ event: 'mail.password_changed', outcome: 'sent', userId })
  }, () => {
    // Including a Resend-in-test refusal. The password is already saved.
    logger.warn({ event: 'mail.password_changed', outcome: 'send_failed', userId })
  })
}
