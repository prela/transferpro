import { expect, it } from 'vitest'
import { createResendMailer, invitationEmail } from './mailer'

const invitationId = '6b1e0c3a-2222-4222-8222-222222222222'
const inviteUrl = `http://localhost:3000/accept-invite#${invitationId}`

const mail = {
  to: 'dora@example.com',
  inviteUrl,
  role: 'driver' as const,
  tenantName: 'Prijevoz <Dubrovnik>',
  locale: 'hr' as const,
}

it('writes the Croatian invite with the link and an escaped tenant name', () => {
  const message = invitationEmail(mail)
  expect(message.subject).toBe('Pozivnica u Prijevoz <Dubrovnik>')
  expect(message.text).toContain('vozač')
  expect(message.text).toContain(inviteUrl)
  expect(message.text).toContain('7 dana')
  expect(message.html).toContain('Prijevoz &lt;Dubrovnik&gt;')
  expect(message.html).not.toContain('Prijevoz <Dubrovnik>')
})

it('writes the English invite', () => {
  const message = invitationEmail({ ...mail, locale: 'en', tenantName: 'Dubrovnik' })
  expect(message.subject).toBe('Invitation to Dubrovnik')
  expect(message.text).toContain('as driver')
  expect(message.text).toContain('7 days')
})

it('posts to Resend and refuses a failed send without echoing the link', async () => {
  const seen: { url: string, body: string, authorization: string }[] = []
  const mailer = createResendMailer('test-resend-key', async (input, init) => {
    seen.push({
      url: String(input),
      body: String(init?.body),
      authorization: new Headers(init?.headers).get('authorization') ?? '',
    })
    return new Response('no', { status: 422 })
  })

  await expect(mailer.sendInvitation(mail)).rejects.toThrow('Invitation email was not sent.')
  expect(seen).toHaveLength(1)
  expect(seen[0]?.url).toBe('https://api.resend.com/emails')
  expect(seen[0]?.authorization).toBe('Bearer test-resend-key')
  const body = JSON.parse(seen[0]?.body ?? '{}') as { from: string, to: string[], text: string }
  expect(body.from).toBe('Transferpro <noreply@transfers.prela.net>')
  expect(body.to).toEqual(['dora@example.com'])
  expect(body.text).toContain(inviteUrl)
  try {
    await mailer.sendInvitation(mail)
  }
  catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(invitationId)
  }
})
