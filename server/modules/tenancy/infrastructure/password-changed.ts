import type pg from 'pg'
import type { DisplayLocale } from '../../../../shared'
import type { Logger } from '../../../core/index'
import type { Mailer } from './mailer'
import { z } from 'zod'
import { displayLocaleSchema } from '../../../../shared'

/**
 * The address and the locale for a password mail. A missing locale is
 * Croatian. Null when the account row cannot be read. Callers must not log it.
 */
export async function passwordMailAccount(
  pool: pg.Pool,
  userId: string,
): Promise<{ readonly to: string, readonly locale: DisplayLocale } | null> {
  const result = await pool.query(
    'select email, locale from auth."user" where id = $1',
    [userId],
  )
  const row = z.object({
    email: z.string().min(1),
    locale: z.string().nullable(),
  }).safeParse(result.rows[0])
  if (!row.success)
    return null
  const chosen = displayLocaleSchema.safeParse(row.data.locale)
  return { to: row.data.email, locale: chosen.success ? chosen.data : 'hr' }
}

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
  queuePasswordChangedMail(mailer, logger, userId, mail)
}

/**
 * The notice only. A reset logs `auth.password_reset` itself and then calls
 * this, so the changed mail is not counted by the reset limit and is not awaited.
 */
export function queuePasswordChangedMail(
  mailer: Mailer | undefined,
  logger: Logger,
  userId: string,
  mail: { readonly to: string, readonly locale: DisplayLocale } | null,
): void {
  if (mailer === undefined || mail === null) {
    logger.warn({ event: 'mail.password_changed', outcome: 'send_failed', userId })
    return
  }
  // Not awaited. The password response is already decided.
  void mailer.sendPasswordChanged(mail).then(() => {
    logger.info({ event: 'mail.password_changed', outcome: 'sent', userId })
  }, () => {
    // Including a Resend-in-test refusal. The password is already saved.
    logger.warn({ event: 'mail.password_changed', outcome: 'send_failed', userId })
  })
}
