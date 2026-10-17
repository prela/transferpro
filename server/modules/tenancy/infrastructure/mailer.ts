import type { DisplayLocale, TenantRole } from '../../../../shared'
import type { Logger } from '../../../core/index'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { getLogger, nodeEnv } from '../../../core/index'
import { INVITATION_EXPIRES_DAYS } from './tenant-roles'

/**
 * Invitation mail and a Driver work order. Tests pass a fake.
 * The Resend adapter is the production implementation and is not used in tests.
 */
export interface InvitationMail {
  readonly to: string
  readonly inviteUrl: string
  readonly role: TenantRole
  readonly tenantName: string
  readonly locale: DisplayLocale
}

/**
 * A work order already composed by the transfers module. This adapter
 * only delivers it. The subject names a place, so callers must not log it.
 */
export interface WorkOrderMail {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * The expected arrival moved. The wording of the mail is a later ticket.
 * This is the same port, not a new channel. The instants are ISO-8601 UTC.
 */
export interface ArrivalMovedNotice {
  readonly rideId: string
  readonly driverId: string
  readonly previous: string
  readonly next: string
}

/**
 * The flight will not arrive at this airport. The wording of the mail is a
 * later ticket. This is the same port, not a new channel, and it is not a
 * moved arrival. No landing time is on it.
 */
export interface FlightWillNotArriveNotice {
  readonly rideId: string
  readonly driverId: string
}

/**
 * Someone changed this account's password. No Tenant, no person, no link.
 * The address is the recipient only. Callers must not log it.
 */
export interface PasswordChangedMail {
  readonly to: string
  readonly locale: DisplayLocale
}

/**
 * A link that sets a new password. No Tenant and no person.
 * The address and the link are bearer material. Callers must not log either.
 */
export interface PasswordResetMail {
  readonly to: string
  readonly resetUrl: string
  readonly locale: DisplayLocale
}

export interface Mailer {
  sendInvitation: (mail: InvitationMail) => Promise<void>
  sendWorkOrder: (mail: WorkOrderMail) => Promise<void>
  notifyArrivalMoved: (notice: ArrivalMovedNotice) => Promise<void>
  notifyFlightWillNotArrive: (notice: FlightWillNotArriveNotice) => Promise<void>
  sendPasswordChanged: (mail: PasswordChangedMail) => Promise<void>
  sendPasswordReset: (mail: PasswordResetMail) => Promise<void>
}

/**
 * Raised when the live server would send through Resend while `NODE_ENV`
 * is `test`. Playwright's server must exit on this rather than deliver mail.
 */
export class ResendTransportError extends Error {
  constructor() {
    super('The Resend transport must not be active when NODE_ENV is test.')
    this.name = 'ResendTransportError'
  }
}

const resendMailers = new WeakSet<Mailer>()
const consoleMailers = new WeakSet<Mailer>()

/** Records the invite, the work order, and an arrival movement. It does not call the network. */
export function createFakeMailer(
  outbox: InvitationMail[] = [],
  workOrders: WorkOrderMail[] = [],
  arrivalMoves: ArrivalMovedNotice[] = [],
  willNotArrive: FlightWillNotArriveNotice[] = [],
  passwordChanged: PasswordChangedMail[] = [],
  passwordResets: PasswordResetMail[] = [],
): Mailer {
  return {
    async sendInvitation(mail) {
      outbox.push({ ...mail })
    },
    async sendWorkOrder(mail) {
      workOrders.push({ ...mail })
    },
    async notifyArrivalMoved(notice) {
      arrivalMoves.push({ ...notice })
    },
    async notifyFlightWillNotArrive(notice) {
      willNotArrive.push({ ...notice })
    },
    async sendPasswordChanged(mail) {
      passwordChanged.push({ ...mail })
    },
    async sendPasswordReset(mail) {
      passwordResets.push({ ...mail })
      // The verification row stores a hash. E2e reads the mailed token from this file.
      rememberResetForE2e(mail)
    },
  }
}

/**
 * Only the e2e server sets the path, and only while `NODE_ENV` is `test`.
 * A development or production process must not write the bearer to disk.
 */
function rememberResetForE2e(mail: PasswordResetMail): void {
  // Bracket access so a Nitro build does not bake an empty path into the server.
  // eslint-disable-next-line dot-notation
  const file = process.env['E2E_PASSWORD_RESET_OUTBOX']
  if (nodeEnv() !== 'test' || file === undefined || file === '')
    return
  appendFileSync(file, `${JSON.stringify({ to: mail.to, resetUrl: mail.resetUrl })}\n`)
}

export function isResendMailer(mailer: Mailer | undefined): boolean {
  return mailer !== undefined && resendMailers.has(mailer)
}

export function isConsoleMailer(mailer: Mailer | undefined): boolean {
  return mailer !== undefined && consoleMailers.has(mailer)
}

/**
 * Local delivery. An invitation line carries the subject and the
 * recipient's domain: the address, body, and invite link stay off the log.
 * A work order's subject is the pickup place, and the address stays off
 * the log, so that line carries only the kind.
 */
export function createConsoleMailer(log?: Logger): Mailer {
  const mailer: Mailer = {
    async sendInvitation(mail) {
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        subject: invitationEmail(mail).subject,
        domain: recipientDomain(mail.to),
      })
    },
    async sendWorkOrder() {
      // The subject is the pickup place. The address, including its domain, stays off the log.
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        kind: 'work-order',
      })
    },
    async notifyArrivalMoved(notice) {
      // The address is not on this fact. The instants stay off the log.
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        kind: 'arrival-moved',
        rideId: notice.rideId,
        driverId: notice.driverId,
      })
    },
    async notifyFlightWillNotArrive(notice) {
      // The address is not on this fact. The flight number stays off the log.
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        kind: 'will-not-arrive',
        rideId: notice.rideId,
        driverId: notice.driverId,
      })
    },
    async sendPasswordChanged() {
      // The address stays off the log. The mail names no Tenant and no person.
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        kind: 'password-changed',
      })
    },
    async sendPasswordReset() {
      // The link is a bearer secret and the address is the account.
      // Neither is on this line, on any environment.
      const logger = log ?? getLogger()
      logger.info({
        event: 'mail.console',
        kind: 'password-reset',
      })
    },
  }
  consoleMailers.add(mailer)
  return mailer
}

/** Fails the process when the selected mailer is the Resend adapter. */
export function assertTestMailer(mailer: Mailer | undefined): void {
  if (isResendMailer(mailer))
    throw new ResendTransportError()
}

/**
 * Test always gets the fake, even when a Resend key or `MAIL_ALLOWLIST`
 * is present. Resend is used only when `MAILER=resend` and the key are
 * both set. Development otherwise uses the console mailer so a local
 * process does not spend the shared daily quota. Any other selection of
 * the Resend adapter is refused in test.
 * `log` is the logger for the console line when the allowlist turns a
 * recipient away. Boot omits it and the process logger is used.
 */
export function mailerForApp(env: {
  readonly RESEND_API_KEY: string | undefined
  readonly MAILER?: 'resend' | 'console' | undefined
  readonly MAIL_ALLOWLIST?: readonly string[]
}, log?: Logger): Mailer {
  if (nodeEnv() === 'test') {
    const mailer = createFakeMailer()
    assertTestMailer(mailer)
    return mailer
  }
  if (env.MAILER === 'resend' && env.RESEND_API_KEY !== undefined) {
    return createResendMailer(env.RESEND_API_KEY, fetch, {
      allowlist: env.MAIL_ALLOWLIST,
      log,
    })
  }
  return createConsoleMailer(log)
}

const ROLE_LABEL: Record<DisplayLocale, Record<TenantRole, string>> = {
  hr: { admin: 'administrator', dispatcher: 'dispečer', driver: 'vozač' },
  en: { admin: 'admin', dispatcher: 'dispatcher', driver: 'driver' },
}

export interface InvitationEmail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

/** Croatian or English, from the Tenant default locale. The invitee has no user locale yet. */
export function invitationEmail(mail: InvitationMail): InvitationEmail {
  const role = ROLE_LABEL[mail.locale][mail.role]
  const days = String(INVITATION_EXPIRES_DAYS)
  const safeTenant = escapeHtml(mail.tenantName)
  const safeUrl = escapeHtml(mail.inviteUrl)
  const safeRole = escapeHtml(role)
  if (mail.locale === 'hr') {
    const subject = `Pozivnica u ${mail.tenantName}`
    const text = [
      `Pozvani ste u ${mail.tenantName} kao ${role}.`,
      'Otvorite poveznicu i postavite lozinku:',
      mail.inviteUrl,
      `Poveznica vrijedi ${days} dana.`,
    ].join('\n')
    const html = `<p>Pozvani ste u ${safeTenant} kao ${safeRole}.</p><p><a href="${safeUrl}">Otvorite poveznicu</a> i postavite lozinku.</p><p>Poveznica vrijedi ${days} dana.</p>`
    return { subject, text, html }
  }
  const subject = `Invitation to ${mail.tenantName}`
  const text = [
    `You are invited to ${mail.tenantName} as ${role}.`,
    'Open the link and set a password:',
    mail.inviteUrl,
    `The link is valid for ${days} days.`,
  ].join('\n')
  const html = `<p>You are invited to ${safeTenant} as ${safeRole}.</p><p><a href="${safeUrl}">Open the link</a> and set a password.</p><p>The link is valid for ${days} days.</p>`
  return { subject, text, html }
}

/** The user's locale, or Croatian. No name and no Tenant. The link is the only secret. */
export function passwordResetEmail(mail: PasswordResetMail): InvitationEmail {
  const safeUrl = escapeHtml(mail.resetUrl)
  if (mail.locale === 'hr') {
    const subject = 'Nova lozinka'
    const text = [
      'Zatražili ste novu lozinku.',
      'Otvorite poveznicu i postavite je:',
      mail.resetUrl,
      'Poveznica vrijedi 60 minuta i može se iskoristiti jednom.',
    ].join('\n')
    const html = `<p>Zatražili ste novu lozinku.</p><p><a href="${safeUrl}">Otvorite poveznicu</a> i postavite je.</p><p>Poveznica vrijedi 60 minuta i može se iskoristiti jednom.</p>`
    return { subject, text, html }
  }
  const subject = 'Reset your password'
  const text = [
    'You asked for a new password.',
    'Open the link and set it:',
    mail.resetUrl,
    'The link lasts 60 minutes and works once.',
  ].join('\n')
  const html = `<p>You asked for a new password.</p><p><a href="${safeUrl}">Open the link</a> and set it.</p><p>The link lasts 60 minutes and works once.</p>`
  return { subject, text, html }
}

/** The user's locale, or Croatian. No name, no Tenant, no link. */
export function passwordChangedEmail(mail: PasswordChangedMail): InvitationEmail {
  if (mail.locale === 'hr') {
    const subject = 'Lozinka je promijenjena'
    const text = [
      'Lozinka je promijenjena.',
      'Ako ovu promjenu niste napravili vi, javite se administratoru tvrtke.',
    ].join('\n')
    const html = '<p>Lozinka je promijenjena.</p><p>Ako ovu promjenu niste napravili vi, javite se administratoru tvrtke.</p>'
    return { subject, text, html }
  }
  const subject = 'Your password was changed'
  const text = [
    'Your password was changed.',
    'If you did not make this change, contact your company\'s administrator.',
  ].join('\n')
  const html = '<p>Your password was changed.</p><p>If you did not make this change, contact your company\'s administrator.</p>'
  return { subject, text, html }
}

interface ResendMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

/**
 * Sends through https://api.resend.com. EU dispatch is the domain region
 * eu-west-1 on the Resend side, not a different API host. ADR-0013.
 * `allowlist`, when set, is the only set of recipients that may be posted.
 * Everyone else gets today's console line. The check reads the address
 * about to be posted, so a notice that resolves its recipient inside this
 * adapter is gated the same way as a caller-supplied `to`. ADR-0042.
 */
export function createResendMailer(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  options?: {
    readonly allowlist?: readonly string[]
    readonly log?: Logger
  },
): Mailer {
  const allowlist = options?.allowlist === undefined
    ? undefined
    : new Set(options.allowlist.map(address => address.trim().toLowerCase()))
  // Built only when the list is set. Unset keeps every send on Resend.
  const consoleMailer = allowlist === undefined ? undefined : createConsoleMailer(options?.log)

  /**
   * The only call to Resend. The allowlist sees `message.to`, the address
   * this call would post, so a notice that resolves its recipient and then
   * calls here is gated the same way as a caller-supplied `to`.
   */
  async function send(
    message: ResendMessage,
    failure: string,
    consoleSend: () => Promise<void>,
  ): Promise<void> {
    if (allowlist !== undefined && !allowlist.has(message.to.trim().toLowerCase())) {
      await consoleSend()
      return
    }
    // The default fetch is the real transport. A unit test passes its own
    // fetch and never leaves the process. Test mode must not reach Resend.
    if (nodeEnv() === 'test' && fetchImpl === globalThis.fetch)
      throw new ResendTransportError()
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Transferpro <noreply@transfers.prela.net>',
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
    if (!response.ok) {
      // Drain the body so the socket can close. Do not put it on the error:
      // Resend echoes the recipient and the body.
      await response.arrayBuffer()
      throw new Error(failure)
    }
  }

  const mailer: Mailer = {
    async sendInvitation(mail) {
      const message = invitationEmail(mail)
      await send(
        { to: mail.to, ...message },
        'Invitation email was not sent.',
        async () => { await consoleMailer?.sendInvitation(mail) },
      )
    },
    async sendWorkOrder(mail) {
      await send(
        mail,
        'Work order email was not sent.',
        async () => { await consoleMailer?.sendWorkOrder(mail) },
      )
    },
    // The message text is a later ticket. No address is resolved, so nothing
    // is posted. When one is, it goes through `send`, the only Resend call.
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged(mail) {
      const message = passwordChangedEmail(mail)
      await send(
        { to: mail.to, ...message },
        'Password changed email was not sent.',
        async () => { await consoleMailer?.sendPasswordChanged(mail) },
      )
    },
    async sendPasswordReset(mail) {
      const message = passwordResetEmail(mail)
      await send(
        { to: mail.to, ...message },
        'Password reset email was not sent.',
        async () => { await consoleMailer?.sendPasswordReset(mail) },
      )
    },
  }
  resendMailers.add(mailer)
  return mailer
}

function recipientDomain(address: string): string | undefined {
  const at = address.lastIndexOf('@')
  return at === -1 ? undefined : address.slice(at + 1)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
