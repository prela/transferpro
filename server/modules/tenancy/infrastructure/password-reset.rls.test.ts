import type { PasswordChangedMail, PasswordResetMail } from './mailer'
import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { closeTenantRuntime, readSessionShell } from '..'
import { resetPasswordLink, resetTokenFromLink } from '../../../../shared'
import { parseAppEnv } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { createSuperadmin } from '../../platform'
import { createAuth, signInRateLimit } from './auth'

/**
 * Auth HTTP seam for a password reset. The fake mailer is the outbox.
 * Each request uses its own caller address so Better Auth's 3 per 60 seconds
 * does not hide the per-email hour limit, except the test that checks that rule.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required(process.env.AUTH_DATABASE_URL, 'AUTH_DATABASE_URL')
const migrateDatabaseUrl = required(process.env.DATABASE_MIGRATE_URL, 'DATABASE_MIGRATE_URL')
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

const currentPassword = 'slice241-current-password'
const nextPassword = 'slice241-next-password'
const knownEmail = 'slice241-known@example.com'
const removedEmail = 'slice241-removed@example.com'
const suspendedEmail = 'slice241-suspended@example.com'
const archivedEmail = 'slice241-archived@example.com'
const inviteeEmail = 'slice241-invitee@example.com'
const superEmail = 'slice241-super@example.com'

const resets: PasswordResetMail[] = []
const changed: PasswordChangedMail[] = []
const invites: unknown[] = []
const logs = captureLogs()

const handle = createAuth(env, {
  logger: logs.logger,
  rateLimit: signInRateLimit('production'),
  mailer: {
    async sendInvitation(mail) {
      invites.push(mail)
    },
    async sendWorkOrder() {},
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged(mail) {
      changed.push({ ...mail })
    },
    async sendPasswordReset(mail) {
      resets.push({ ...mail })
    },
  },
})

let releaseHang: () => void = () => {}
const hang = new Promise<void>((resolve) => {
  releaseHang = resolve
})
let hangStarted = 0
const hangLogs = captureLogs()
const hangHandle = createAuth(env, {
  logger: hangLogs.logger,
  rateLimit: signInRateLimit('production'),
  mailer: {
    async sendInvitation() {},
    async sendWorkOrder() {},
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged() {},
    async sendPasswordReset() {
      hangStarted += 1
      return hang
    },
  },
})

const failing: PasswordResetMail[] = []
const failingLogs = captureLogs()
const failingHandle = createAuth(env, {
  logger: failingLogs.logger,
  rateLimit: signInRateLimit('production'),
  mailer: {
    async sendInvitation() {},
    async sendWorkOrder() {},
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged() {},
    async sendPasswordReset(mail) {
      failing.push({ ...mail })
      throw new Error('Password reset email was not sent.')
    },
  },
})

const owner = new pg.Pool({ connectionString: migrateDatabaseUrl, max: 1 })
const userIds: string[] = []
const orgIds: string[] = []
let caller = 1

beforeAll(async () => {
  await forget(knownEmail)
  await forget(removedEmail)
  await forget(suspendedEmail)
  const knownId = await handle.insertInvitedUser({
    email: knownEmail,
    name: 'Ada Reset',
    password: currentPassword,
  })
  userIds.push(knownId)
  await handle.authPool.query('update auth."user" set locale = $1 where id = $2', ['en', knownId])
  const knownOrg = await createOrganization('slice241-known')
  await addMember(knownOrg, knownId, 'admin')

  const removedId = await handle.insertInvitedUser({
    email: removedEmail,
    name: 'Bea Removed',
    password: currentPassword,
  })
  userIds.push(removedId)

  const suspendedId = await handle.insertInvitedUser({
    email: suspendedEmail,
    name: 'Cara Suspended',
    password: currentPassword,
  })
  userIds.push(suspendedId)
  const suspendedOrg = await createOrganization('slice241-suspended')
  await addMember(suspendedOrg, suspendedId, 'dispatcher')
  await owner.query(
    'insert into platform.tenant_account (organization_id, suspended_at) values ($1, now())',
    [suspendedOrg],
  )
})

afterAll(async () => {
  releaseHang()
  await owner.query('delete from app.drivers where member_user_id = any($1::text[])', [userIds])
  for (const id of userIds)
    await handle.deleteUser(id)
  for (const id of orgIds)
    await handle.authPool.query('delete from auth.organization where id = $1', [id])
  await owner.end()
  await handle.close()
  await hangHandle.close()
  await failingHandle.close()
  await closeTenantRuntime()
})

it('answers a known, an unknown, an ineligible, and a limited email the same way without waiting for the send', async () => {
  await forget(superEmail)
  await createSuperadmin({
    name: 'Platform Reset',
    email: superEmail,
    password: currentPassword,
    migrateDatabaseUrl,
  })
  const superId = await handle.userIdByEmail(superEmail)
  expect(superId).toBeTruthy()
  userIds.push(superId!)

  const known = await answered(hangHandle, knownEmail)
  await waitFor(() => hangStarted === 1)
  await answered(hangHandle, knownEmail)
  await waitFor(() => hangStarted === 2)
  await answered(hangHandle, knownEmail)
  await waitFor(() => hangStarted === 3)
  const limited = await answered(hangHandle, knownEmail)
  await waitFor(() => hangLogs.lines().some(line => line.outcome === 'limited'))
  expect(hangStarted).toBe(3)

  const unknown = await answered(hangHandle, 'slice241-unknown@example.com')
  const removed = await answered(hangHandle, removedEmail)
  const suspended = await answered(hangHandle, suspendedEmail)
  const superadmin = await answered(hangHandle, superEmail)
  expect(limited).toEqual(known)
  expect(unknown).toEqual(known)
  expect(removed).toEqual(known)
  expect(suspended).toEqual(known)
  expect(superadmin).toEqual(known)

  const removedId = await handle.userIdByEmail(removedEmail)
  const suspendedId = await handle.userIdByEmail(suspendedEmail)
  expect(hangLogs.lines()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'mail.password_reset', outcome: 'limited', userId: await handle.userIdByEmail(knownEmail) }),
    expect.objectContaining({ event: 'mail.password_reset', outcome: 'not_eligible', userId: removedId }),
    expect.objectContaining({ event: 'mail.password_reset', outcome: 'not_eligible', userId: suspendedId }),
    expect.objectContaining({ event: 'mail.password_reset', outcome: 'not_eligible', userId: superId }),
  ]))
  const text = JSON.stringify(hangLogs.lines())
  expect(text).not.toContain(knownEmail)
  expect(text).not.toContain('slice241-unknown@example.com')
  expect(text).not.toContain(removedEmail)
  expect(text).not.toContain(suspendedEmail)
  expect(text).not.toContain(superEmail)
  expect(text).not.toContain('reset-password#')
})

it('keeps Better Auth at 3 reset requests per 60 seconds for one caller address', async () => {
  const ip = '198.51.100.10'
  const email = 'slice241-rate@example.com'
  const first = await requestReset(handle, email, ip)
  const second = await requestReset(handle, email, ip)
  const third = await requestReset(handle, email, ip)
  const fourth = await requestReset(handle, email, ip)
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect(third.status).toBe(200)
  expect(fourth.status).toBe(429)
  await first.arrayBuffer()
  await second.arrayBuffer()
  await third.arrayBuffer()
  await fourth.arrayBuffer()
})

it('sends the hash link in the user locale, then the fourth mail in an hour logs limited', async () => {
  const email = 'slice241-capped@example.com'
  const id = await provision(email, 'admin', 'en')
  const before = resets.length
  const first = await answered(handle, email)
  await waitFor(() => resets.length === before + 1)
  const token = await latestToken(id, email)
  expect(resets.at(-1)).toEqual({
    to: email,
    locale: 'en',
    resetUrl: resetPasswordLink(baseUrl, token.token),
  })
  const minutes = (token.expiresAt.getTime() - Date.now()) / 60_000
  expect(minutes).toBeGreaterThan(59)
  expect(minutes).toBeLessThan(61)
  expect(JSON.stringify(resets.at(-1))).not.toContain('Quiet Tenant')
  expect(JSON.stringify(resets.at(-1))).not.toContain('Ada Reset')

  await answered(handle, email)
  await answered(handle, email)
  await waitFor(() => resets.length === before + 3)
  const limitedBefore = logs.lines().filter(line => line.outcome === 'limited' && line.userId === id).length
  const answer = await answered(handle, email)
  await waitFor(() => logs.lines().filter(line => line.outcome === 'limited' && line.userId === id).length === limitedBefore + 1)
  expect(resets.length).toBe(before + 3)
  expect(answer).toEqual(first)
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain(email)
  expect(text).not.toContain(token.token)
})

it('stores a hashed reset identifier and not the mailed token', async () => {
  const email = 'slice241-hashed@example.com'
  const id = await provision(email, 'admin', 'hr')
  const before = resets.length
  await answered(handle, email)
  await waitFor(() => resets.length === before + 1)
  const token = resetTokenFromMail(resets.at(-1)?.resetUrl)
  const rows = await handle.authPool.query(
    `select identifier from auth.verification
     where value = $1 and identifier like 'reset-password-hash:%'`,
    [id],
  )
  const identifiers = z.array(z.object({ identifier: z.string() })).parse(rows.rows)
  expect(identifiers.length).toBeGreaterThan(0)
  for (const row of identifiers) {
    expect(row.identifier.startsWith('reset-password-hash:')).toBe(true)
    expect(row.identifier).not.toContain(token)
  }
  const response = await resetPassword(handle, token, nextPassword)
  expect(response.status).toBe(200)
  await response.arrayBuffer()
})

it('refuses the stored hash suffix as a reset token and keeps the password', async () => {
  const email = 'slice241-suffix@example.com'
  const id = await provision(email, 'admin', 'hr')
  const before = resets.length
  await answered(handle, email)
  await waitFor(() => resets.length === before + 1)
  const rows = await handle.authPool.query(
    `select identifier from auth.verification
     where value = $1 and identifier like 'reset-password-hash:%'`,
    [id],
  )
  const identifier = z.object({ identifier: z.string() }).parse(rows.rows[0]).identifier
  const prefix = 'reset-password-hash:'
  expect(identifier.startsWith(prefix)).toBe(true)
  const suffix = identifier.slice(prefix.length)
  const response = await resetPassword(handle, suffix, nextPassword)
  expect(response.status).toBe(400)
  await response.arrayBuffer()
  const signedIn = await signIn(handle, currentPassword, email)
  expect(signedIn.cookie).toBeTruthy()
})

it('mails an archived Driver and does not resend an invitation that has no account', async () => {
  const id = await provision(archivedEmail, 'driver', 'hr')
  const org = orgIds.at(-1)!
  const client = await owner.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [org])
    await client.query(
      `insert into app.drivers (
         tenant_id, name, kind, phone, email,
         driving_licence_expires_on, transport_licence_expires_on,
         member_user_id, archived_at
       ) values ($1, 'Archived Driver', 'own', '091111111', $2, '2030-01-01', '2030-01-01', $3, now())`,
      [org, archivedEmail, id],
    )
    await client.query('commit')
  }
  finally {
    client.release()
  }

  const before = resets.length
  await answered(handle, archivedEmail)
  await waitFor(() => resets.length === before + 1)
  expect(resets.at(-1)?.to).toBe(archivedEmail)
  expect(JSON.stringify(resets.at(-1))).not.toContain('Archived Driver')

  const inviter = id
  await handle.authPool.query(
    `insert into auth.invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
     values ($1, $2, $3, 'driver', 'pending', now() + interval '7 days', now(), $4)`,
    [crypto.randomUUID(), org, inviteeEmail, inviter],
  )
  const invitesBefore = invites.length
  const resetsBefore = resets.length
  await answered(handle, inviteeEmail)
  expect(invites.length).toBe(invitesBefore)
  expect(resets.filter(mail => mail.to === inviteeEmail)).toEqual([])
  expect(resets.length).toBe(resetsBefore)
  const status = await handle.authPool.query(
    'select status from auth.invitation where email = $1',
    [inviteeEmail],
  )
  expect(status.rows).toEqual([{ status: 'pending' }])
  expect(JSON.stringify(logs.lines())).not.toContain(inviteeEmail)
})

it('logs send_failed when the reset mail throws and still returns', async () => {
  const email = 'slice241-fail@example.com'
  const id = await provision(email, 'admin', 'hr')
  const response = await requestReset(failingHandle, email)
  expect(response.status).toBe(200)
  await response.arrayBuffer()
  await waitFor(() => failingLogs.lines().some(line => line.outcome === 'send_failed' && line.userId === id))
  expect(failing).toEqual([expect.objectContaining({ to: email })])
  expect(JSON.stringify(failingLogs.lines())).not.toContain(email)
})

it('answers GET /api/auth/reset-password/<token> with 404', async () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWx'
  const response = await handle.auth.handler(new Request(`${baseUrl}/api/auth/reset-password/${token}`, {
    headers: { origin: baseUrl },
  }))
  expect(response.status).toBe(404)
  await response.arrayBuffer()
})

it('uses a link once, drops the older link, and refuses an expired one', async () => {
  const email = 'slice241-once@example.com'
  const id = await provision(email, 'admin', 'hr')
  const before = resets.filter(mail => mail.to === email).length
  await answered(handle, email)
  await waitFor(() => resets.filter(mail => mail.to === email).length === before + 1)
  const older = await latestToken(id, email)
  await answered(handle, email)
  await waitFor(() => resets.filter(mail => mail.to === email).length === before + 2)
  const newer = await latestToken(id, email)
  expect(newer.token).not.toBe(older.token)
  const keptId = crypto.randomUUID()
  await handle.authPool.query(
    `insert into auth.verification (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, 'keep-verification:not-a-reset', $2, now() + interval '1 hour', now(), now())`,
    [keptId, id],
  )

  const first = await resetPassword(handle, newer.token, nextPassword)
  expect(first.status).toBe(200)
  await first.arrayBuffer()
  const again = await resetPassword(handle, newer.token, 'slice241-other-password')
  expect(again.status).toBe(400)
  await again.arrayBuffer()
  const stale = await resetPassword(handle, older.token, 'slice241-stale-password')
  expect(stale.status).toBe(400)
  await stale.arrayBuffer()
  const kept = await handle.authPool.query(
    'select identifier from auth.verification where id = $1',
    [keptId],
  )
  expect(kept.rows).toEqual([{ identifier: 'keep-verification:not-a-reset' }])
  const leftover = await handle.authPool.query(
    `select identifier from auth.verification
     where value = $1
       and (identifier like 'reset-password-hash:%' or identifier like 'reset-password:%')`,
    [id],
  )
  expect(leftover.rows).toEqual([])

  const expired = 'ExpiredTokenExpiredToken'
  await handle.authPool.query(
    `insert into auth.verification (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, $2, $3, now() - interval '1 minute', now(), now())`,
    [crypto.randomUUID(), `reset-password:${expired}`, id],
  )
  const past = await resetPassword(handle, expired, 'slice241-expired-password')
  expect(past.status).toBe(400)
  await past.arrayBuffer()
  const signedIn = await signIn(handle, nextPassword, email)
  expect(signedIn.cookie).toBeTruthy()
})

it('refuses a password outside the shared length rule', async () => {
  const email = 'slice241-short@example.com'
  const id = await provision(email, 'admin', 'hr')
  await answered(handle, email)
  await waitFor(() => resets.some(mail => mail.to === email))
  const token = await latestToken(id, email)
  const response = await resetPassword(handle, token.token, 'short')
  expect(response.status).toBe(400)
  await response.arrayBuffer()
  const signedIn = await signIn(handle, currentPassword, email)
  expect(signedIn.cookie).toBeTruthy()
})

it('ends every session, including a browser signed in as someone else, and still sends the changed mail', async () => {
  const email = 'slice241-sessions@example.com'
  const id = await provision(email, 'admin', 'hr')
  const otherEmail = 'slice241-other@example.com'
  const otherId = await provision(otherEmail, 'dispatcher', 'hr')
  await answered(handle, email)
  await answered(handle, email)
  await answered(handle, email)
  await waitFor(() => resets.filter(mail => mail.to === email).length === 3)
  const token = await latestToken(id, email)
  const first = await signIn(handle, currentPassword, email)
  const second = await signIn(handle, currentPassword, email)
  const other = await signIn(handle, currentPassword, otherEmail)
  expect(await sessionUser(handle, other.cookie)).toBe(otherId)

  const changedBefore = changed.length
  const response = await resetPassword(handle, token.token, nextPassword, other.cookie)
  expect(response.status).toBe(200)
  await response.arrayBuffer()
  await expectSignedOut(first.cookie)
  await expectSignedOut(second.cookie)
  await expectSignedOut(other.cookie)

  const limitedBefore = logs.lines().filter(line => line.outcome === 'limited' && line.userId === id).length
  await answered(handle, email)
  await waitFor(() => logs.lines().filter(line => line.outcome === 'limited' && line.userId === id).length === limitedBefore + 1)
  await waitFor(() => changed.length === changedBefore + 1)
  expect(changed.at(-1)).toEqual({ to: email, locale: 'hr' })
  expect(resets.filter(mail => mail.to === email)).toHaveLength(3)
  expect(logs.lines()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'auth.password_reset', userId: id }),
    expect.objectContaining({ event: 'mail.password_changed', outcome: 'sent', userId: id }),
    expect.objectContaining({ event: 'mail.password_reset', outcome: 'limited', userId: id }),
  ]))
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain(email)
  expect(text).not.toContain(otherEmail)
  expect(text).not.toContain(token.token)
  expect(text).not.toContain(nextPassword)
})

async function provision(email: string, role: 'admin' | 'dispatcher' | 'driver', locale: 'hr' | 'en'): Promise<string> {
  await forget(email)
  const id = await handle.insertInvitedUser({
    email,
    name: 'Member Reset',
    password: currentPassword,
  })
  userIds.push(id)
  await handle.authPool.query('update auth."user" set locale = $1 where id = $2', [locale, id])
  const org = await createOrganization(`slice241-${id.slice(0, 8)}`)
  await addMember(org, id, role)
  return id
}

async function forget(email: string): Promise<void> {
  const id = await handle.userIdByEmail(email)
  if (id)
    await handle.deleteUser(id)
}

async function createOrganization(slug: string): Promise<string> {
  const id = crypto.randomUUID()
  await handle.authPool.query(
    `insert into auth.organization (id, name, slug, created_at) values ($1, 'Quiet Tenant', $2, now())`,
    [id, slug],
  )
  orgIds.push(id)
  return id
}

async function addMember(organizationId: string, userId: string, role: string): Promise<void> {
  await handle.authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), organizationId, userId, role],
  )
}

function callerIp(): string {
  const host = (caller % 250) + 1
  caller += 1
  return `203.0.113.${host}`
}

async function requestReset(auth: ReturnType<typeof createAuth>, email: string, ip = callerIp()): Promise<Response> {
  return Promise.race([
    auth.auth.handler(new Request(`${baseUrl}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': baseUrl,
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ email }),
    })),
    new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error('reset request waited for the send')), 2000)
    }),
  ])
}

async function answered(auth: ReturnType<typeof createAuth>, email: string): Promise<unknown> {
  const response = await requestReset(auth, email)
  expect(response.status).toBe(200)
  return response.json()
}

async function resetPassword(
  auth: ReturnType<typeof createAuth>,
  token: string,
  password: string,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'origin': baseUrl,
    'x-forwarded-for': callerIp(),
  }
  if (cookie)
    headers.cookie = cookie
  return auth.auth.handler(new Request(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ newPassword: password, token }),
  }))
}

function resetTokenFromMail(resetUrl: string | undefined): string {
  const token = resetUrl === undefined ? '' : resetTokenFromLink(resetUrl)
  if (token.length < 8)
    throw new Error('reset mail has no token')
  return token
}

async function latestToken(userId: string, email: string): Promise<{ token: string, expiresAt: Date }> {
  const mail = [...resets].reverse().find(row => row.to === email)
  const token = resetTokenFromMail(mail?.resetUrl)
  const result = await handle.authPool.query(
    `select expires_at from auth.verification
     where value = $1 and identifier like 'reset-password-hash:%'
     order by created_at desc
     limit 1`,
    [userId],
  )
  const row = z.object({
    expires_at: z.coerce.date(),
  }).parse(result.rows[0])
  return {
    token,
    expiresAt: row.expires_at,
  }
}

async function signIn(auth: ReturnType<typeof createAuth>, password: string, address: string) {
  const response = await auth.auth.handler(new Request(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
      'x-forwarded-for': callerIp(),
    },
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

async function expectSignedOut(cookie: string): Promise<void> {
  await expect(readSessionShell(new Headers({ cookie, origin: baseUrl }))).rejects.toMatchObject({ statusCode: 401 })
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (ready())
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('the password reset did not settle')
}
