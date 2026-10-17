import type { DisplayLocale, TenantRole } from '../../../../shared'
import type { Logger } from '../../../core/index'
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

export interface Mailer {
  sendInvitation: (mail: InvitationMail) => Promise<void>
  sendWorkOrder: (mail: WorkOrderMail) => Promise<void>
  notifyArrivalMoved: (notice: ArrivalMovedNotice) => Promise<void>
  notifyFlightWillNotArrive: (notice: FlightWillNotArriveNotice) => Promise<void>
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
  }
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
 * `log` is the console line for a recipient the allowlist turns away.
 * Boot omits it and the process logger is used.
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

  async function post(message: ResendMessage, failure: string): Promise<void> {
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

  /**
   * The allowlist sees `message.to`, the address this call would post.
   * Callers that already know the recipient, and a notice that looks one
   * up before calling this, share this gate.
   */
  async function deliver(
    message: ResendMessage,
    failure: string,
    consoleSend: () => Promise<void>,
  ): Promise<void> {
    if (allowlist !== undefined && !allowlist.has(message.to.trim().toLowerCase())) {
      await consoleSend()
      return
    }
    await post(message, failure)
  }

  const mailer: Mailer = {
    async sendInvitation(mail) {
      const message = invitationEmail(mail)
      await deliver(
        { to: mail.to, ...message },
        'Invitation email was not sent.',
        async () => { await consoleMailer?.sendInvitation(mail) },
      )
    },
    async sendWorkOrder(mail) {
      await deliver(
        mail,
        'Work order email was not sent.',
        async () => { await consoleMailer?.sendWorkOrder(mail) },
      )
    },
    // The message text is a later ticket. No address is resolved, so nothing
    // is posted. When one is, it must go through `deliver`.
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
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
