import type { WorkOrderMail } from './mailer'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { captureLogs } from '../../../core/testing'
import { workOrderIdempotencyKey } from '../../mail/domain/idempotency-key'
import { assertTestMailer, createConsoleMailer, createFakeMailer, createResendMailer, invitationEmail, isConsoleMailer, isResendMailer, mailerForApp, passwordChangedEmail, passwordResetEmail, ResendTransportError, TransientMailError } from './mailer'

const invitationId = '6b1e0c3a-2222-4222-8222-222222222222'
const inviteUrl = `http://localhost:3000/accept-invite#${invitationId}`
const resetToken = 'AbCdEfGhIjKlMnOpQrStUvWx'
const resetUrl = `http://localhost:3000/reset-password#${resetToken}`

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

it('posts a work order and refuses a failed send without echoing the body', async () => {
  const seen: string[] = []
  const mailer = createResendMailer('test-resend-key', async (input, init) => {
    seen.push(String(init?.body))
    return new Response('no', { status: 422 })
  })
  const workOrder = {
    to: 'ana@example.test',
    subject: 'Dodijeljeno · Zračna luka',
    text: 'Gost: Ana',
    html: '<p>Gost: Ana</p>',
  }
  await expect(mailer.sendWorkOrder(workOrder)).rejects.toThrow('Work order email was not sent.')
  const body = JSON.parse(seen[0] ?? '{}') as { from: string, to: string[], text: string }
  expect(body.from).toBe('Transferpro <noreply@transfers.prela.net>')
  expect(body.to).toEqual(['ana@example.test'])
  expect(body.text).toContain('Gost: Ana')
  try {
    await mailer.sendWorkOrder(workOrder)
  }
  catch (error) {
    expect((error as Error).message).not.toContain('ana@example.test')
    expect((error as Error).message).not.toContain('Zračna luka')
  }
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
    const mailer = mailerForApp({ RESEND_API_KEY: 're_live_key', MAILER: 'resend' })
    expect(isResendMailer(mailer)).toBe(false)
    expect(isConsoleMailer(mailer)).toBe(false)
    await mailer?.sendInvitation(mail)
    expect(calls).toEqual([])
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

it('keeps the fake mailer in test when the allowlist and a Resend key are set', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response('sent', { status: 200 })
  }
  try {
    const mailer = mailerForApp({
      RESEND_API_KEY: 're_live_key',
      MAILER: 'resend',
      MAIL_ALLOWLIST: ['dora@example.com'],
    })
    expect(isResendMailer(mailer)).toBe(false)
    expect(isConsoleMailer(mailer)).toBe(false)
    await mailer.sendInvitation(mail)
    expect(calls).toEqual([])
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

it('uses the console mailer in development unless MAILER=resend and the key are both set', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    const fallback = mailerForApp({ RESEND_API_KEY: 're_live_key' })
    expect(isConsoleMailer(fallback)).toBe(true)
    expect(isResendMailer(fallback)).toBe(false)
    const resend = mailerForApp({ RESEND_API_KEY: 're_live_key', MAILER: 'resend' })
    expect(isResendMailer(resend)).toBe(true)
    expect(isConsoleMailer(resend)).toBe(false)
    const missingKey = mailerForApp({ RESEND_API_KEY: undefined, MAILER: 'resend' })
    expect(isConsoleMailer(missingKey)).toBe(true)
  }
  finally {
    restoreNodeEnv(previous)
  }
})

it('logs a work order without the subject, the address, or the body', async () => {
  const logs = captureLogs()
  const mailer = createConsoleMailer(logs.logger)
  await mailer.sendWorkOrder({
    to: 'ana@example.test',
    subject: 'Dodijeljeno · 16. 10. 2026. 00:30 · Zračna luka Dubrovnik',
    text: 'Gost: Ana Tajna',
    html: '<p>Gost: Ana Tajna</p>',
  })
  const [line] = logs.lines()
  expect(line).toMatchObject({ event: 'mail.console', kind: 'work-order' })
  const text = JSON.stringify(line)
  expect(text).not.toContain('ana@example.test')
  expect(text).not.toContain('example.test')
  expect(text).not.toContain('Zračna luka')
  expect(text).not.toContain('Ana Tajna')
  expect(text).not.toContain('Dodijeljeno')
})

it('logs only the subject and the recipient domain from the console mailer', async () => {
  const logs = captureLogs()
  const mailer = createConsoleMailer(logs.logger)
  expect(isConsoleMailer(mailer)).toBe(true)
  await mailer.sendInvitation(mail)
  const [line] = logs.lines()
  expect(line?.event).toBe('mail.console')
  expect(line?.subject).toBe('Pozivnica u Prijevoz <Dubrovnik>')
  expect(line?.domain).toBe('example.com')
  const text = JSON.stringify(line)
  expect(text).not.toContain('dora@example.com')
  expect(text).not.toContain(inviteUrl)
  expect(text).not.toContain(invitationId)
  expect(text).not.toContain('Otvorite poveznicu')
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

it('sends only allowlisted recipients through Resend', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const logs = captureLogs()
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    calls.push(String(init?.body))
    return new Response('sent', { status: 200 })
  }
  const workOrder = {
    to: 'other@example.com',
    subject: 'Dodijeljeno · Zračna luka',
    text: 'Gost: Ana Tajna',
    html: '<p>Gost: Ana Tajna</p>',
  }
  try {
    const mailer = mailerForApp({
      RESEND_API_KEY: 're_live_key',
      MAILER: 'resend',
      MAIL_ALLOWLIST: ['owner@example.com'],
    }, logs.logger)
    expect(isResendMailer(mailer)).toBe(true)
    await mailer.sendInvitation({ ...mail, to: ' Owner@Example.com ' })
    await mailer.sendInvitation({ ...mail, to: 'other@example.com' })
    await mailer.sendWorkOrder({ ...workOrder, to: 'owner@example.com' })
    await mailer.sendWorkOrder(workOrder)
    await mailer.notifyArrivalMoved({
      rideId: 'ride-1',
      driverId: 'driver-1',
      previous: '2026-10-17T08:00:00.000Z',
      next: '2026-10-17T09:00:00.000Z',
    })
    await mailer.notifyFlightWillNotArrive({ rideId: 'ride-1', driverId: 'driver-1' })
    await mailer.sendPasswordChanged({ to: 'other@example.com', locale: 'hr' })
    await mailer.sendPasswordChanged({ to: 'owner@example.com', locale: 'en' })
    await mailer.sendPasswordReset({ to: 'other@example.com', resetUrl, locale: 'hr' })
    await mailer.sendPasswordReset({ to: 'owner@example.com', resetUrl, locale: 'en' })
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
  const bodies = calls.map(body => JSON.parse(body) as { to: string[] })
  expect(bodies.map(body => body.to)).toEqual([
    [' Owner@Example.com '],
    ['owner@example.com'],
    ['owner@example.com'],
    ['owner@example.com'],
  ])
  const changed = JSON.parse(calls[2] ?? '{}') as { subject: string, text: string, html: string }
  expect(changed.subject).toBe('Your password was changed')
  expect(changed.text).not.toMatch(/https?:\/\//)
  expect(changed.html).not.toContain('href')
  const lines = logs.lines()
  expect(lines[0]).toMatchObject({
    event: 'mail.console',
    subject: 'Pozivnica u Prijevoz <Dubrovnik>',
    domain: 'example.com',
  })
  expect(lines[1]).toMatchObject({
    event: 'mail.console',
    kind: 'work-order',
  })
  expect(lines[2]).toMatchObject({
    event: 'mail.console',
    kind: 'password-changed',
  })
  expect(lines[3]).toMatchObject({
    event: 'mail.console',
    kind: 'password-reset',
  })
  expect(lines).toHaveLength(4)
  const text = JSON.stringify(lines)
  expect(text).not.toContain('other@example.com')
  expect(text).not.toContain('Ana Tajna')
  expect(text).not.toContain('Zračna luka')
  expect(text).not.toContain(inviteUrl)
  expect(text).not.toContain(resetUrl)
  expect(text).not.toContain(resetToken)
})

it('still sends every recipient when MAIL_ALLOWLIST is unset', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    calls.push(String(init?.body))
    return new Response('sent', { status: 200 })
  }
  try {
    const mailer = mailerForApp({ RESEND_API_KEY: 're_live_key', MAILER: 'resend' })
    await mailer.sendInvitation(mail)
    expect(calls).toHaveLength(1)
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

it('writes the password changed notice in Croatian and English, with no link and no person', () => {
  const croatian = passwordChangedEmail({ to: 'ada@example.test', locale: 'hr' })
  expect(croatian.subject).toBe('Lozinka je promijenjena')
  expect(croatian.text).toContain('administratoru tvrtke')
  expect(croatian.text).not.toMatch(/https?:\/\//)
  expect(croatian.html).not.toContain('href')
  expect(croatian.text).not.toContain('ada@example.test')
  const english = passwordChangedEmail({ to: 'ada@example.test', locale: 'en' })
  expect(english.subject).toBe('Your password was changed')
  expect(english.text).toContain('company\'s administrator')
  expect(english.text).not.toContain('ada@example.test')
})

it('logs a password changed console line without the address', async () => {
  const logs = captureLogs()
  const mailer = createConsoleMailer(logs.logger)
  await mailer.sendPasswordChanged({ to: 'ada@example.test', locale: 'hr' })
  const [line] = logs.lines()
  expect(line).toMatchObject({ event: 'mail.console', kind: 'password-changed' })
  expect(JSON.stringify(line)).not.toContain('ada@example.test')
  expect(JSON.stringify(line)).not.toContain('example.test')
})

it('writes the reset link for the e2e server only while NODE_ENV is test', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'transferpro-reset-'))
  const file = join(directory, 'outbox.jsonl')
  const previousEnv = process.env.NODE_ENV
  const previousFile = process.env.E2E_PASSWORD_RESET_OUTBOX
  process.env.E2E_PASSWORD_RESET_OUTBOX = file
  try {
    process.env.NODE_ENV = 'development'
    await createFakeMailer().sendPasswordReset({ to: 'ada@example.test', resetUrl, locale: 'hr' })
    expect(() => readFileSync(file, 'utf8')).toThrow()

    process.env.NODE_ENV = 'test'
    await createFakeMailer().sendPasswordReset({ to: 'ada@example.test', resetUrl, locale: 'hr' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      to: 'ada@example.test',
      resetUrl,
    })
  }
  finally {
    if (previousEnv === undefined)
      delete process.env.NODE_ENV
    else
      process.env.NODE_ENV = previousEnv
    if (previousFile === undefined)
      delete process.env.E2E_PASSWORD_RESET_OUTBOX
    else
      process.env.E2E_PASSWORD_RESET_OUTBOX = previousFile
    rmSync(directory, { recursive: true, force: true })
  }
})

it('sends the idempotency key, and a changed message gets a new one', async () => {
  const seen: string[] = []
  const mailer = createResendMailer('test-resend-key', async (_input, init) => {
    seen.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
    return new Response('sent', { status: 200 })
  })
  const entryId = 'd1d1d1d1-1111-4111-8111-111111111111'
  const to = 'ana@example.test'
  const message = { subject: 'Dodijeljeno', text: 'Gost: Ana', html: '<p>Gost: Ana</p>' }
  const key = workOrderIdempotencyKey(entryId, message, to)
  await mailer.sendWorkOrder({ to, ...message, idempotencyKey: key })
  await mailer.sendWorkOrder({ to, ...message, idempotencyKey: key })
  const changed = workOrderIdempotencyKey(entryId, { ...message, text: 'Gost: Marko' }, to)
  await mailer.sendWorkOrder({ to: 'ana@example.test', ...message, text: 'Gost: Marko', idempotencyKey: changed })
  expect(seen).toEqual([key, key, changed])
  expect(changed).not.toBe(key)
})

it('treats a concurrent idempotency conflict as a transient failure and does not echo the body', async () => {
  const mailer = createResendMailer('test-resend-key', async () => new Response(JSON.stringify({
    name: 'concurrent_idempotent_requests',
    message: 'ana@example.test Gost: Ana',
  }), { status: 409 }))
  const workOrder = {
    to: 'ana@example.test',
    subject: 'Dodijeljeno',
    text: 'Gost: Ana',
    html: '<p>Gost: Ana</p>',
    idempotencyKey: 'd1d1d1d1-1111-4111-8111-111111111111.abc',
  }
  await expect(mailer.sendWorkOrder(workOrder)).rejects.toBeInstanceOf(TransientMailError)
  await expect(mailer.sendWorkOrder(workOrder)).rejects.toThrow('Mail delivery was not completed.')
  try {
    await mailer.sendWorkOrder(workOrder)
  }
  catch (error) {
    expect((error as Error).message).not.toContain('ana@example.test')
    expect((error as Error).message).not.toContain('Gost: Ana')
  }
})

it('rejects the e2e failure address and records every other work order', async () => {
  const workOrders: WorkOrderMail[] = []
  const mailer = createFakeMailer([], workOrders)
  const message = { subject: 'Dodijeljeno', text: 'Gost', html: '<p>Gost</p>' }
  await expect(mailer.sendWorkOrder({
    to: 'work-order-fail@example.test',
    ...message,
  })).rejects.toThrow('Work order email was not sent.')
  expect(workOrders).toHaveLength(0)
  await mailer.sendWorkOrder({
    to: 'ana@example.test',
    ...message,
    idempotencyKey: 'd1d1d1d1-1111-4111-8111-111111111111.abc',
  })
  expect(workOrders).toEqual([{ to: 'ana@example.test', ...message }])
  expect(JSON.stringify(workOrders)).not.toContain('idempotency')
})

it('leaves the idempotency key off the console line', async () => {
  const logs = captureLogs()
  const mailer = createConsoleMailer(logs.logger)
  await mailer.sendWorkOrder({
    to: 'ana@example.test',
    subject: 'Zračna luka',
    text: 'Gost: Ana',
    html: '<p>Gost: Ana</p>',
    idempotencyKey: 'd1d1d1d1-1111-4111-8111-111111111111.abc',
  })
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain('ana@example.test')
  expect(text).not.toContain('Zračna luka')
  expect(text).not.toContain('idempotency')
  expect(text).not.toContain('d1d1d1d1')
})

it('records one password changed mail on the fake mailer', async () => {
  const changed: { to: string, locale: 'hr' | 'en' }[] = []
  const mailer = createFakeMailer([], [], [], [], changed)
  await mailer.sendPasswordChanged({ to: 'ada@example.test', locale: 'en' })
  expect(changed).toEqual([{ to: 'ada@example.test', locale: 'en' }])
})

it('writes the reset mail in the user locale with the hash link and no person', () => {
  const croatian = passwordResetEmail({ to: 'ada@example.test', resetUrl, locale: 'hr' })
  expect(croatian.subject).toBe('Nova lozinka')
  expect(croatian.text).toContain(resetUrl)
  expect(croatian.text).toContain('60 minuta')
  expect(croatian.html).toContain(`href="${resetUrl}"`)
  expect(croatian.text).not.toContain('ada@example.test')
  expect(croatian.text).not.toContain('Quiet Tenant')
  const english = passwordResetEmail({ to: 'ada@example.test', resetUrl, locale: 'en' })
  expect(english.subject).toBe('Reset your password')
  expect(english.text).toContain('60 minutes')
  expect(english.text).toContain(resetUrl)
})

it('logs a password reset console line without the link or the address', async () => {
  const logs = captureLogs()
  const mailer = createConsoleMailer(logs.logger)
  await mailer.sendPasswordReset({ to: 'ada@example.test', resetUrl, locale: 'hr' })
  const [line] = logs.lines()
  expect(line).toMatchObject({ event: 'mail.console', kind: 'password-reset' })
  const text = JSON.stringify(line)
  expect(text).not.toContain('ada@example.test')
  expect(text).not.toContain(resetUrl)
  expect(text).not.toContain(resetToken)
})

function restoreNodeEnv(previous: string | undefined) {
  if (previous === undefined)
    delete process.env.NODE_ENV
  else
    process.env.NODE_ENV = previous
}
