import type { PasswordChangedMail } from './mailer'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { passwordLengthLimits } from '../../../../shared'
import { parseAppEnv } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { createAuth } from './auth'

/**
 * Auth HTTP seam for a password change. The fake mailer is the outbox.
 * A log line may carry the user id and must not carry the address.
 */
loadEnvFile('.env')

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required(process.env.AUTH_DATABASE_URL, 'AUTH_DATABASE_URL')
const baseUrl = required(process.env.BETTER_AUTH_URL, 'BETTER_AUTH_URL')

const env = parseAppEnv({
  DATABASE_URL: required(process.env.DATABASE_URL, 'DATABASE_URL'),
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: required(process.env.QUEUE_DATABASE_URL, 'QUEUE_DATABASE_URL'),
  PLATFORM_DATABASE_URL: required(process.env.PLATFORM_DATABASE_URL, 'PLATFORM_DATABASE_URL'),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: baseUrl,
  NODE_ENV: 'test',
})

const currentPassword = 'slice308-current-password'
const nextPassword = 'slice308-next-password'
const email = 'slice308-change@example.com'

const changed: PasswordChangedMail[] = []
const failing: PasswordChangedMail[] = []

const logs = captureLogs()
const failingLogs = captureLogs()

const handle = createAuth(env, {
  logger: logs.logger,
  mailer: {
    async sendInvitation() {},
    async sendWorkOrder() {},
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged(mail) {
      changed.push({ ...mail })
    },
  },
})

const failingHandle = createAuth(env, {
  logger: failingLogs.logger,
  mailer: {
    async sendInvitation() {},
    async sendWorkOrder() {},
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged(mail) {
      failing.push({ ...mail })
      throw new Error('Password changed email was not sent.')
    },
  },
})

beforeAll(async () => {
  await handle.deleteUser(await userId(handle, email) ?? '')
  await handle.insertInvitedUser({
    email,
    name: 'Ada Change',
    password: currentPassword,
  })
})

afterAll(async () => {
  const id = await userId(handle, email)
  if (id)
    await handle.deleteUser(id)
  await handle.close()
  await failingHandle.close()
})

it('passes the shared length bounds to Better Auth', async () => {
  const limits = (await handle.auth.$context).password.config
  expect(limits).toEqual(passwordLengthLimits)
})

it('refuses a wrong current password and keeps every session', async () => {
  const first = await signIn(handle, currentPassword)
  const second = await signIn(handle, currentPassword)
  const response = await changePassword(handle, first.cookie, 'not-the-password', nextPassword)
  expect(response.status).toBe(400)
  await response.arrayBuffer()
  expect(changed).toEqual([])
  expect(logs.lines().some(line => line.event === 'auth.password_changed')).toBe(false)
  expect((await sessionUser(handle, first.cookie))).toBeTruthy()
  expect((await sessionUser(handle, second.cookie))).toBeTruthy()
})

it('keeps the current browser, ends the other session, and queues one mail', async () => {
  const id = await userId(handle, email)
  expect(id).toBeTruthy()
  await handle.authPool.query('update auth."user" set locale = $1 where id = $2', ['en', id])
  const current = await signIn(handle, currentPassword)
  const other = await signIn(handle, currentPassword)
  const before = changed.length
  const response = await changePassword(handle, current.cookie, currentPassword, nextPassword)
  expect(response.status).toBe(200)
  await response.arrayBuffer()
  const kept = sessionCookie(response)
  expect(await sessionUser(handle, kept)).toBe(id)
  expect((await changePassword(handle, other.cookie, nextPassword, 'slice308-other-password')).status).toBe(401)
  expect((await changePassword(handle, current.cookie, nextPassword, 'slice308-old-password')).status).toBe(401)
  await waitFor(() => changed.length === before + 1)
  expect(changed.at(-1)).toEqual({ to: email, locale: 'en' })
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain(email)
  expect(text).not.toContain(nextPassword)
  expect(text).not.toContain(currentPassword)
  expect(logs.lines()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'auth.password_changed', userId: id }),
    expect.objectContaining({ event: 'mail.password_changed', outcome: 'sent', userId: id }),
  ]))
})

it('still changes the password when the mail fails, and logs send_failed', async () => {
  const failingEmail = 'slice308-fail@example.com'
  await failingHandle.deleteUser(await userId(failingHandle, failingEmail) ?? '')
  const id = await failingHandle.insertInvitedUser({
    email: failingEmail,
    name: 'Bea Fail',
    password: currentPassword,
  })
  try {
    const current = await signIn(failingHandle, currentPassword, failingEmail)
    const response = await changePassword(failingHandle, current.cookie, currentPassword, nextPassword)
    expect(response.status).toBe(200)
    const kept = sessionCookie(response)
    await response.arrayBuffer()
    expect(await sessionUser(failingHandle, kept)).toBe(id)
    await waitFor(() => failingLogs.lines().some(line => line.outcome === 'send_failed'))
    expect(failing).toEqual([{ to: failingEmail, locale: 'hr' }])
    const text = JSON.stringify(failingLogs.lines())
    expect(text).not.toContain(failingEmail)
    expect(failingLogs.lines()).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'auth.password_changed', userId: id }),
      expect.objectContaining({ event: 'mail.password_changed', outcome: 'send_failed', userId: id }),
    ]))
  }
  finally {
    await failingHandle.deleteUser(id)
  }
})

async function userId(auth: ReturnType<typeof createAuth>, address: string): Promise<string | null> {
  return auth.userIdByEmail(address)
}

async function signIn(auth: ReturnType<typeof createAuth>, password: string, address = email) {
  const response = await auth.auth.handler(new Request(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': baseUrl },
    body: JSON.stringify({ email: address, password }),
  }))
  if (response.status !== 200) {
    await response.arrayBuffer()
    throw new Error('sign-in did not succeed')
  }
  return { cookie: sessionCookie(response) }
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.getSetCookie().find(part => part.includes('session_token'))
  const cookie = setCookie?.split(';')[0]
  if (!cookie)
    throw new Error('no session cookie')
  return cookie
}

async function changePassword(
  auth: ReturnType<typeof createAuth>,
  cookie: string,
  current: string,
  next: string,
): Promise<Response> {
  return auth.auth.handler(new Request(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
      cookie,
    },
    body: JSON.stringify({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    }),
  }))
}

async function sessionUser(auth: ReturnType<typeof createAuth>, cookie: string): Promise<string | null> {
  const response = await auth.auth.handler(new Request(`${baseUrl}/api/auth/get-session`, {
    headers: { origin: baseUrl, cookie },
  }))
  if (response.status !== 200) {
    await response.arrayBuffer()
    return null
  }
  const body = await response.json() as { user?: { id?: string } } | null
  return body?.user?.id ?? null
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (ready())
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the password changed mail did not settle')
}
