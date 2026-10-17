import type pg from 'pg'
import type { Logger } from '../../../core/index'
import type { Mailer } from './mailer'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resetPasswordLink } from '../../../../shared'
import { passwordMailAccount } from './password-changed'

/**
 * One hour, counted in this process only. A restart or a second instance
 * starts again at zero (ADR-0042). The key is the lowercased address, and
 * the count is mails we decided to send, not refused requests.
 */
const RESET_MAILS_PER_HOUR = 3
const RESET_MAIL_WINDOW_MS = 60 * 60 * 1000

/** The link lifetime Better Auth stores on the verification row. */
export const RESET_PASSWORD_TOKEN_SECONDS = 60 * 60

/**
 * Better Auth builds `reset-password:<token>`. The override key is this
 * prefix, so only reset rows are hashed. Invitations live in
 * `auth.invitation` and never take this path.
 */
export const RESET_PASSWORD_IDENTIFIER_PREFIX = 'reset-password:'

/**
 * Stored form is `reset-password:<sha256>`. The prefix is what
 * `deleteRemainingResetTokens` matches. The digest is of the whole
 * identifier, so the mailed token is not a substring of the row.
 */
export async function hashResetPasswordIdentifier(identifier: string): Promise<string> {
  const digest = createHash('sha256').update(identifier).digest('base64url')
  return `${RESET_PASSWORD_IDENTIFIER_PREFIX}${digest}`
}

export function createResetMailLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  return function allowResetMail(email: string): boolean {
    const key = email.trim().toLowerCase()
    const horizon = now() - RESET_MAIL_WINDOW_MS
    const recent = (hits.get(key) ?? []).filter(at => at > horizon)
    if (recent.length >= RESET_MAILS_PER_HOUR) {
      hits.set(key, recent)
      return false
    }
    recent.push(now())
    hits.set(key, recent)
    return true
  }
}

export interface PasswordResetDelivery {
  readonly pool: pg.Pool
  readonly mailer: Mailer | undefined
  readonly logger: Logger
  readonly allowResetMail: (email: string) => boolean
  readonly baseURL: string
  readonly userId: string
  readonly token: string
}

/**
 * Better Auth awaits `sendResetPassword`, so this returns before any check
 * or send. A known address must not wait longer than an unknown one, and a
 * send that never settles must not hold the response.
 */
export function queuePasswordReset(input: PasswordResetDelivery): void {
  void deliverPasswordReset(input)
}

/**
 * A successful reset already consumed its token. Any earlier link of this
 * user must fail too. Hashed rows still start with the prefix, and so do
 * plaintext rows left from before hashing. The prefix keeps every other
 * verification row.
 */
export async function deleteRemainingResetTokens(pool: pg.Pool, userId: string): Promise<void> {
  await pool.query(
    `delete from auth.verification
     where value = $1 and identifier like 'reset-password:%'`,
    [userId],
  )
}

async function deliverPasswordReset(input: PasswordResetDelivery): Promise<void> {
  const { logger, userId } = input
  try {
    if (!await eligibleForReset(input.pool, userId)) {
      logger.info({ event: 'mail.password_reset', outcome: 'not_eligible', userId })
      return
    }
    const account = await passwordMailAccount(input.pool, userId)
    if (account === null || input.mailer === undefined) {
      logger.warn({ event: 'mail.password_reset', outcome: 'send_failed', userId })
      return
    }
    // After eligibility, so a removed member does not spend the hour.
    if (!input.allowResetMail(account.to)) {
      logger.info({ event: 'mail.password_reset', outcome: 'limited', userId })
      return
    }
    await input.mailer.sendPasswordReset({
      to: account.to,
      resetUrl: resetPasswordLink(input.baseURL, input.token),
      locale: account.locale,
    })
    logger.info({ event: 'mail.password_reset', outcome: 'sent', userId })
  }
  catch {
    // The response already left. The token expires in 60 minutes either way.
    logger.warn({ event: 'mail.password_reset', outcome: 'send_failed', userId })
  }
}

/**
 * At least one membership in an active Tenant, and never a Superadmin.
 * An archived Driver stays a member, so this does not read app.drivers.
 * Active means no row in platform.tenant_account.
 */
async function eligibleForReset(pool: pg.Pool, userId: string): Promise<boolean> {
  const grant = await pool.query(
    'select user_id from platform.superadmin where user_id = $1',
    [userId],
  )
  if ((grant.rowCount ?? 0) > 0)
    return false
  const members = await pool.query(
    'select organization_id from auth.member where user_id = $1',
    [userId],
  )
  const rows = z.array(z.object({ organization_id: z.string() })).parse(members.rows)
  for (const row of rows) {
    const suspended = await pool.query(
      'select organization_id from platform.tenant_account where organization_id = $1',
      [row.organization_id],
    )
    if ((suspended.rowCount ?? 0) === 0)
      return true
  }
  return false
}
