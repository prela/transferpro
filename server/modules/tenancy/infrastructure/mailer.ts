import type { DisplayLocale, TenantRole } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { INVITATION_EXPIRES_DAYS } from './tenant-roles'

/**
 * The only mail the app sends in this slice. Tests pass a fake.
 * The Resend adapter is the production implementation and is not used in tests.
 */
export interface InvitationMail {
  readonly to: string
  readonly inviteUrl: string
  readonly role: TenantRole
  readonly tenantName: string
  readonly locale: DisplayLocale
}

export interface Mailer {
  sendInvitation: (mail: InvitationMail) => Promise<void>
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

/** Records the invite and does not call the network. */
export function createFakeMailer(outbox: InvitationMail[] = []): Mailer {
  return {
    async sendInvitation(mail) {
      outbox.push({ ...mail })
    },
  }
}

export function isResendMailer(mailer: Mailer | undefined): boolean {
  return mailer !== undefined && resendMailers.has(mailer)
}

/** Fails the process when the selected mailer is the Resend adapter. */
export function assertTestMailer(mailer: Mailer | undefined): void {
  if (isResendMailer(mailer))
    throw new ResendTransportError()
}

/**
 * Test always gets the fake, even when a Resend key is present in the
 * environment. Any other selection of the Resend adapter is refused.
 */
export function mailerForApp(env: { readonly RESEND_API_KEY: string | undefined }): Mailer | undefined {
  const mailer = nodeEnv() === 'test'
    ? createFakeMailer()
    : env.RESEND_API_KEY === undefined
      ? undefined
      : createResendMailer(env.RESEND_API_KEY)
  if (nodeEnv() === 'test')
    assertTestMailer(mailer)
  return mailer
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

/**
 * Sends through https://api.resend.com. EU dispatch is the domain region
 * eu-west-1 on the Resend side, not a different API host. ADR-0013.
 */
export function createResendMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  const mailer: Mailer = {
    async sendInvitation(mail) {
      // The default fetch is the real transport. A unit test passes its own
      // fetch and never leaves the process. Test mode must not reach Resend.
      if (nodeEnv() === 'test' && fetchImpl === globalThis.fetch)
        throw new ResendTransportError()
      const message = invitationEmail(mail)
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Transferpro <noreply@transfers.prela.net>',
          to: [mail.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })
      if (!response.ok) {
        // Drain the body so the socket can close. Do not put it on the error:
        // Resend echoes the recipient and the link.
        await response.arrayBuffer()
        throw new Error('Invitation email was not sent.')
      }
    },
  }
  resendMailers.add(mailer)
  return mailer
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
