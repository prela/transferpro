import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { deliverInvitationEmail, inviteSendState } from './invite-send'
import { ResendTransportError } from './mailer'

const mail = {
  to: 'dora@example.com',
  inviteUrl: 'http://localhost:3000/accept-invite#6b1e0c3a-2222-4222-8222-222222222222',
  role: 'driver' as const,
  tenantName: 'Dubrovnik',
  locale: 'hr' as const,
}

it('keeps the invite and reports a failed send without rethrowing', async () => {
  const logs = captureLogs()
  const state = { locale: 'hr' as const, emailSent: false }
  await inviteSendState.run(state, async () => {
    await deliverInvitationEmail({
      async sendInvitation() {
        throw new Error('Invitation email was not sent.')
      },
    }, mail, logs.logger)
  })
  expect(state.emailSent).toBe(false)
})

it('warns on a failed send without the address or the invite link', async () => {
  const logs = captureLogs()
  const state = { locale: 'hr' as const, emailSent: false }
  await inviteSendState.run(state, async () => {
    await deliverInvitationEmail({
      async sendInvitation() {
        throw new Error('Invitation email was not sent.')
      },
    }, mail, logs.logger)
  })
  expect(state.emailSent).toBe(false)
  const [line] = logs.lines()
  expect(line).toMatchObject({
    level: 40,
    event: 'invite.email_failed',
    err: {
      type: 'Error',
      message: 'Invitation email was not sent.',
    },
  })
  expect((line?.err as { stack?: string } | undefined)?.stack).toBeUndefined()
  const text = JSON.stringify(line)
  expect(text).not.toContain('dora@example.com')
  expect(text).not.toContain(mail.inviteUrl)
})

it('marks the send as delivered when the mailer succeeds', async () => {
  const state = { locale: 'hr' as const, emailSent: false }
  await inviteSendState.run(state, async () => {
    await deliverInvitationEmail({
      async sendInvitation() {},
    }, mail)
  })
  expect(state.emailSent).toBe(true)
})

it('still fails the request when the Resend transport is selected in test', async () => {
  await expect(deliverInvitationEmail({
    async sendInvitation() {
      throw new ResendTransportError()
    },
  }, mail)).rejects.toBeInstanceOf(ResendTransportError)
})
