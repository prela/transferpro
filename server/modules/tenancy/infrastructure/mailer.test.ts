import { expect, it } from 'vitest'
import { assertTestMailer, createResendMailer, invitationEmail, isResendMailer, mailerForApp, ResendTransportError } from './mailer'

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

it('uses the fake mailer in test even when a Resend key is present', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response('sent', { status: 200 })
  }
  try {
    const mailer = mailerForApp({ RESEND_API_KEY: 're_live_key' })
    expect(isResendMailer(mailer)).toBe(false)
    await mailer?.sendInvitation(mail)
    expect(calls).toEqual([])
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

it('refuses to start when the Resend transport is selected for test', () => {
  const mailer = createResendMailer('re_live_key', async () => new Response('no'))
  expect(isResendMailer(mailer)).toBe(true)
  expect(() => assertTestMailer(mailer)).toThrow(ResendTransportError)
  expect(() => assertTestMailer(mailer)).toThrow('The Resend transport must not be active when NODE_ENV is test.')
})

it('does not call Resend from the default transport when NODE_ENV is test', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response('sent', { status: 200 })
  }
  try {
    await expect(createResendMailer('re_live_key', globalThis.fetch).sendInvitation(mail)).rejects.toBeInstanceOf(ResendTransportError)
    expect(calls).toEqual([])
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

function restoreNodeEnv(previous: string | undefined) {
  if (previous === undefined)
    delete process.env.NODE_ENV
  else
    process.env.NODE_ENV = previous
}
