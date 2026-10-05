import type { AuthHandle } from './auth'
import type { InvitationMail } from './mailer'
import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, readSessionShell, removeTenantMember } from '..'
import { parseAppEnv } from '../../../core/index'
import { createAuth, signInRateLimit } from './auth'
import { createTenant } from './create-tenant'
import { acceptInvitation, InvitationAccessError, previewInvitation, sendInvitation } from './invitation'

/**
 * Invitation seam: invite, accept, and the other tenant's session.
 * Rows and the session shell are the observation. Policy text is not.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const databaseUrl = required(process.env.DATABASE_URL, 'DATABASE_URL')
const authDatabaseUrl = required(process.env.AUTH_DATABASE_URL, 'AUTH_DATABASE_URL')
const migrateDatabaseUrl = required(process.env.DATABASE_MIGRATE_URL, 'DATABASE_MIGRATE_URL')
const queueDatabaseUrl = required(process.env.QUEUE_DATABASE_URL, 'QUEUE_DATABASE_URL')
const baseUrl = required(process.env.BETTER_AUTH_URL, 'BETTER_AUTH_URL')

const env = parseAppEnv({
  DATABASE_URL: databaseUrl,
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: queueDatabaseUrl,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: baseUrl,
  NODE_ENV: 'test',
})

const adminPassword = 'slice11-admin-password'
const memberPassword = 'slice11-member-password'
const slugA = 'slice11-a'
const slugB = 'slice11-b'
const adminEmail = 'slice11-admin@example.com'
const otherEmail = 'slice11-other@example.com'

const sent: InvitationMail[] = []
const mailer = {
  async sendInvitation(mail: InvitationMail) {
    sent.push(mail)
  },
}

const appPool = new pg.Pool({ connectionString: databaseUrl })
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

let handle: AuthHandle
let tenantA = ''
let tenantB = ''
let adminHeaders: Headers

beforeAll(async () => {
  await removeTenant(slugA, [adminEmail])
  await removeTenant(slugB, [otherEmail])
  const createdA = await createTenant({
    name: 'Slice 11 A',
    slug: slugA,
    adminEmail,
    adminName: 'Ana Admin',
    password: adminPassword,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  const createdB = await createTenant({
    name: 'Slice 11 B',
    slug: slugB,
    adminEmail: otherEmail,
    adminName: 'Boris Other',
    password: adminPassword,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  tenantA = createdA.tenantId
  tenantB = createdB.tenantId
  handle = createAuth(env, { mailer })
  adminHeaders = (await signIn(adminEmail)).headers
})

afterAll(async () => {
  await removeTenant(slugA, [
    adminEmail,
    'slice11-driver@example.com',
    'slice11-dispatcher@example.com',
    'slice11-second-admin@example.com',
    'slice11-expired@example.com',
    'slice11-reused@example.com',
    'slice11-stranger@example.com',
    'slice11-short@example.com',
    'slice11-hidden@example.com',
    'slice11-rollback@example.com',
    'slice11-burst-0@example.com',
    'slice11-burst-1@example.com',
    'slice11-burst-2@example.com',
    'slice11-burst-3@example.com',
    'slice11-pending@example.com',
    'slice11-removed@example.com',
  ])
  await removeTenant(slugB, [otherEmail])
  if (handle !== undefined)
    await handle.close()
  await closeTenantRuntime()
  await appPool.end()
  await authPool.end()
  await ownerPool.end()
})

it('lets an admin invite admin, dispatcher, and driver, and refuses the other roles', async () => {
  const driver = await sendInvitation(handle, adminHeaders, {
    email: 'slice11-driver@example.com',
    role: 'driver',
    organizationId: tenantA,
    locale: 'hr',
  })
  const dispatcher = await sendInvitation(handle, adminHeaders, {
    email: 'slice11-dispatcher@example.com',
    role: 'dispatcher',
    organizationId: tenantA,
    locale: 'hr',
  })
  const secondAdmin = await sendInvitation(handle, adminHeaders, {
    email: 'slice11-second-admin@example.com',
    role: 'admin',
    organizationId: tenantA,
    locale: 'hr',
  })

  expect(sent.map(mail => mail.role)).toEqual(['driver', 'dispatcher', 'admin'])
  expect(sent.every(mail => mail.locale === 'hr' && mail.to.endsWith('@example.com'))).toBe(true)
  for (const link of [driver.inviteUrl, dispatcher.inviteUrl, secondAdmin.inviteUrl]) {
    const url = new URL(link)
    expect(url.search).toBe('')
    expect(url.hash).toMatch(/^#[0-9a-f-]{36}$/)
  }
  expect(driver.emailSent).toBe(true)

  const driverId = new URL(driver.inviteUrl).hash.slice(1)
  const expiresAt = await invitationExpiry(driverId)
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000)
  expect(expiresAt.getTime()).toBeLessThan(Date.now() + sevenDaysMs + 60_000)

  const limits = (await handle.auth.$context).password.config
  expect(await previewInvitation(handle, { invitationId: driverId })).toEqual({
    state: 'set-password',
    minPasswordLength: limits.minPasswordLength,
    maxPasswordLength: limits.maxPasswordLength,
  })
  // A body email is ignored. The account is the invitation address.
  const accepted = await acceptInvitation(handle, {
    invitationId: driverId,
    email: 'not-the-invite@example.com',
    name: 'Dora Driver',
    password: memberPassword,
  }, new Headers())
  // The browser stores a Set-Cookie with no Path on this route's directory.
  // Path=/, HttpOnly, and SameSite=Lax are what a sign-in cookie carries.
  const sessionCookie = accepted.cookies.find(part => part.includes('session_token'))
  expect(sessionCookie).toBeDefined()
  const attributes = sessionCookie?.split(';').slice(1).map(part => part.trim())
  expect(attributes).toContain('Path=/')
  expect(attributes).toContain('HttpOnly')
  expect(attributes).toContain('SameSite=Lax')
  const shell = await readSessionShell(cookieHeaders(accepted.cookies))
  expect(shell.tenantId).toBe(tenantA)
  expect(shell.role).toBe('driver')
  await expect(signIn('not-the-invite@example.com', memberPassword)).rejects.toThrow()

  const dispatcherSession = await acceptRole('slice11-dispatcher@example.com', dispatcher.inviteUrl, 'dispatcher')
  const adminSession = await acceptRole('slice11-second-admin@example.com', secondAdmin.inviteUrl, 'admin')
  expect(dispatcherSession.role).toBe('dispatcher')
  expect(adminSession.role).toBe('admin')

  const dispatcherHeaders = (await signIn('slice11-dispatcher@example.com', memberPassword)).headers
  const driverHeaders = (await signIn('slice11-driver@example.com', memberPassword)).headers
  const before = sent.length
  await expect(sendInvitation(handle, dispatcherHeaders, {
    email: 'slice11-nope@example.com',
    role: 'driver',
    organizationId: tenantA,
    locale: 'hr',
  })).rejects.toMatchObject({ statusCode: 403 })
  await expect(sendInvitation(handle, driverHeaders, {
    email: 'slice11-nope@example.com',
    role: 'driver',
    organizationId: tenantA,
    locale: 'hr',
  })).rejects.toMatchObject({ statusCode: 403 })
  expect(sent).toHaveLength(before)
})

it('refuses an expired, reused, or other-email invitation', async () => {
  const expired = await invite('slice11-expired@example.com', 'driver')
  await authPool.query(
    `update auth.invitation set expires_at = now() - interval '1 minute' where id = $1`,
    [expired.id],
  )
  expect(await previewInvitation(handle, { invitationId: expired.id })).toEqual({ state: 'invalid' })
  await expect(acceptInvitation(handle, {
    invitationId: expired.id,
    name: 'Expired',
    password: memberPassword,
  }, new Headers())).rejects.toMatchObject({ statusCode: 400 })
  await expect(signIn('slice11-expired@example.com', memberPassword)).rejects.toThrow()

  const reused = await invite('slice11-reused@example.com', 'driver')
  await acceptInvitation(handle, {
    invitationId: reused.id,
    name: 'Rene',
    password: memberPassword,
  }, new Headers())
  await expect(acceptInvitation(handle, {
    invitationId: reused.id,
    name: 'Rene',
    password: memberPassword,
  }, new Headers())).rejects.toMatchObject({ statusCode: 400 })

  const stranger = await invite('slice11-stranger@example.com', 'driver')
  await expect(acceptInvitation(handle, {
    invitationId: stranger.id,
  }, adminHeaders)).rejects.toMatchObject({ statusCode: 403 })
  const stillPending = await withApp(tenantA, async (client) => {
    const selected = await client.query(
      'select status from app.tenant_invitation where id = $1',
      [stranger.id],
    )
    return selected.rows
  })
  expect(stillPending).toEqual([{ status: 'pending' }])
})

it('asks an existing account to sign in, then accepts into this tenant', async () => {
  const invited = await invite(otherEmail, 'dispatcher')
  expect(await previewInvitation(handle, { invitationId: invited.id })).toEqual({ state: 'sign-in' })
  await expect(acceptInvitation(handle, {
    invitationId: invited.id,
    name: 'Boris Other',
    password: 'a-different-password',
  }, new Headers())).rejects.toMatchObject({ statusCode: 409 })

  const signedIn = await signIn(otherEmail, adminPassword)
  const accepted = await acceptInvitation(handle, { invitationId: invited.id }, signedIn.headers)
  // The invitee already had a session. Accept must not issue another one.
  expect(accepted.cookies).toEqual([])
  const shell = await readSessionShell(cookieHeaders([signedIn.cookie]))
  expect(shell.tenantId).toBe(tenantA)
  expect(shell.role).toBe('dispatcher')
})

it('hides this tenant\'s invitations from another tenant session', async () => {
  const invited = await invite('slice11-hidden@example.com', 'driver')
  const seenByA = await withApp(tenantA, async (client) => {
    const selected = await client.query(
      'select id, role, status from app.tenant_invitation where id = $1',
      [invited.id],
    )
    return selected.rows
  })
  const seenByB = await withApp(tenantB, async (client) => {
    const selected = await client.query(
      'select id from app.tenant_invitation where id = $1',
      [invited.id],
    )
    return selected.rows
  })
  const seenByNobody = await withApp(null, async (client) => {
    const selected = await client.query('select id from app.tenant_invitation')
    return selected.rows
  })
  expect(seenByA).toEqual([{ id: invited.id, role: 'driver', status: 'pending' }])
  expect(seenByB).toEqual([])
  expect(seenByNobody).toEqual([])
  expect(JSON.stringify(seenByA)).not.toContain('slice11-hidden@example.com')

  await expect(withApp(tenantA, client =>
    client.query('select email from app.tenant_invitation'))).rejects.toThrow(/email/)
  await expect(withApp(tenantB, client =>
    client.query('select id from auth.invitation'))).rejects.toThrow(/permission denied/)

  const otherHeaders = (await signIn(otherEmail, adminPassword)).headers
  await expect(acceptInvitation(handle, { invitationId: invited.id }, otherHeaders)).rejects.toMatchObject({ statusCode: 403 })
  expect(await previewInvitation(handle, { invitationId: invited.id }, otherHeaders)).toEqual({
    state: 'wrong-account',
    account: otherEmail,
  })
})

it('uses the auth password limits and still refuses public sign-up', async () => {
  const ctx = await handle.auth.$context
  const { minPasswordLength, maxPasswordLength } = ctx.password.config
  const invited = await invite('slice11-short@example.com', 'driver')
  await expect(acceptInvitation(handle, {
    invitationId: invited.id,
    name: 'Short',
    password: 'a'.repeat(minPasswordLength - 1),
  }, new Headers())).rejects.toMatchObject({ statusCode: 422 })
  await expect(acceptInvitation(handle, {
    invitationId: invited.id,
    name: 'Long',
    password: 'a'.repeat(maxPasswordLength + 1),
  }, new Headers())).rejects.toMatchObject({ statusCode: 422 })
  await expect(signIn('slice11-short@example.com', memberPassword)).rejects.toThrow()

  const response = await handle.auth.handler(new Request(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
    },
    body: JSON.stringify({
      name: 'Public',
      email: 'slice11-public@example.com',
      password: memberPassword,
    }),
  }))
  expect(response.status).not.toBe(200)
  await response.arrayBuffer()
})

it('refuses a bad accept body without repeating the id or the email', async () => {
  const id = 'not-a-uuid'
  const email = 'slice11-body@example.com'
  const error = await acceptInvitation(handle, {
    invitationId: id,
    email,
    name: 'Bad',
    password: memberPassword,
  }, new Headers()).then(() => {
    throw new Error('accept should have failed')
  }, (caught: unknown) => caught)
  expect(error).toMatchObject({ statusCode: 400, message: 'Invitation is not valid.' })
  expect(error).toBeInstanceOf(InvitationAccessError)
  expect((error as InvitationAccessError).message).not.toContain(id)
  expect((error as InvitationAccessError).message).not.toContain(email)

  const preview = await previewInvitation(handle, { invitationId: id, email }).then(() => {
    throw new Error('preview should have failed')
  }, (caught: unknown) => caught)
  expect(preview).toBeInstanceOf(InvitationAccessError)
  expect((preview as InvitationAccessError).message).not.toContain(id)
  expect((preview as InvitationAccessError).message).not.toContain(email)
})

it('deletes the new user when accept fails after insert, then a retry works', async () => {
  const email = 'slice11-rollback@example.com'
  const invited = await invite(email, 'driver')
  const signInEmail = handle.auth.api.signInEmail
  // The property is readonly on the type. The method is still a writable field.
  Object.assign(handle.auth.api, {
    signInEmail: () => Promise.reject(new Error('sign-in failed')),
  })
  try {
    await expect(acceptInvitation(handle, {
      invitationId: invited.id,
      name: 'Rollback',
      password: memberPassword,
    }, new Headers())).rejects.toMatchObject({ statusCode: 500 })
  }
  finally {
    Object.assign(handle.auth.api, { signInEmail })
  }
  const user = await authPool.query('select id from auth."user" where lower(email) = $1', [email])
  expect(user.rows).toEqual([])
  const pending = await authPool.query('select status from auth.invitation where id = $1', [invited.id])
  expect(pending.rows).toEqual([{ status: 'pending' }])

  const accepted = await acceptInvitation(handle, {
    invitationId: invited.id,
    name: 'Rollback',
    password: memberPassword,
  }, new Headers())
  const shell = await readSessionShell(cookieHeaders(accepted.cookies))
  expect(shell.tenantId).toBe(tenantA)
  expect(shell.role).toBe('driver')
})

it('answers 409 when the person is already a member or already invited, and invites them again after removal', async () => {
  await expect(sendInvitation(handle, adminHeaders, {
    email: adminEmail,
    role: 'driver',
    organizationId: tenantA,
    locale: 'hr',
  })).rejects.toMatchObject({ statusCode: 409, message: 'Account already exists.' })

  const pending = 'slice11-pending@example.com'
  await invite(pending, 'driver')
  await expect(invite(pending, 'dispatcher')).rejects.toMatchObject({ statusCode: 409 })

  const removed = 'slice11-removed@example.com'
  const invited = await invite(removed, 'driver')
  const accepted = await acceptInvitation(handle, {
    invitationId: invited.id,
    name: 'Removed Member',
    password: memberPassword,
  }, new Headers())
  const shell = await readSessionShell(cookieHeaders(accepted.cookies))
  await removeTenantMember(adminHeaders, shell.userId)
  const again = await invite(removed, 'dispatcher')
  expect(new URL(again.inviteUrl).hash).toMatch(/^#[0-9a-f-]{36}$/)
})

it('accepts four new accounts while the production sign-in limit is on', async () => {
  const limited = createAuth(env, {
    mailer,
    rateLimit: signInRateLimit('production'),
  })
  try {
    const ctx = await limited.auth.$context
    expect(ctx.rateLimit.enabled).toBe(true)
    expect(ctx.rateLimit.customRules?.['/sign-in/email']).toEqual({ window: 10, max: 3 })
    for (let index = 0; index < 4; index++) {
      const email = `slice11-burst-${index}@example.com`
      const invited = await sendInvitation(limited, adminHeaders, {
        email,
        role: 'driver',
        organizationId: tenantA,
        locale: 'hr',
      })
      const accepted = await acceptInvitation(limited, {
        invitationId: new URL(invited.inviteUrl).hash.slice(1),
        name: email,
        password: memberPassword,
      }, new Headers(), { key: `203.0.113.${index}` })
      const shell = await readSessionShell(cookieHeaders(accepted.cookies))
      expect(shell.tenantId).toBe(tenantA)
      expect(shell.role).toBe('driver')
    }
  }
  finally {
    await limited.close()
  }
})

async function invite(email: string, role: 'admin' | 'dispatcher' | 'driver') {
  const result = await sendInvitation(handle, adminHeaders, {
    email,
    role,
    organizationId: tenantA,
    locale: 'hr',
  })
  return { ...result, id: new URL(result.inviteUrl).hash.slice(1) }
}

async function acceptRole(email: string, inviteUrl: string, role: 'admin' | 'dispatcher' | 'driver') {
  const accepted = await acceptInvitation(handle, {
    invitationId: new URL(inviteUrl).hash.slice(1),
    name: email,
    password: memberPassword,
  }, new Headers())
  const shell = await readSessionShell(cookieHeaders(accepted.cookies))
  expect(shell.role).toBe(role)
  expect(shell.tenantId).toBe(tenantA)
  return shell
}

async function invitationExpiry(id: string): Promise<Date> {
  const result = await authPool.query<{ expires_at: Date }>(
    'select expires_at from auth.invitation where id = $1',
    [id],
  )
  const expiresAt = result.rows[0]?.expires_at
  if (expiresAt === undefined)
    throw new Error('Invitation expiry is missing.')
  return expiresAt
}

async function signIn(email: string, password = adminPassword) {
  const response = await handle.auth.handler(new Request(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': baseUrl,
    },
    body: JSON.stringify({ email, password }),
  }))
  if (response.status !== 200) {
    await response.arrayBuffer()
    throw new Error('sign-in did not succeed')
  }
  const setCookie = response.headers.getSetCookie().find(part => part.includes('session_token'))
  if (setCookie === undefined)
    throw new Error('sign-in did not set a session cookie')
  const cookie = setCookie.split(';')[0] ?? ''
  return { cookie, headers: new Headers({ cookie }) }
}

function cookieHeaders(cookies: readonly string[]): Headers {
  const cookie = cookies
    .map(part => part.split(';')[0]?.trim() ?? '')
    .filter(part => part !== '')
    .join('; ')
  return new Headers({ cookie })
}

async function withApp<T>(tenantId: string | null, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    if (tenantId !== null)
      await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

async function removeTenant(slug: string, emails: readonly string[]) {
  const owner = await ownerPool.connect()
  try {
    await owner.query(
      `delete from app.tenant_settings
       where tenant_id::text in (select id from auth.organization where slug = $1)`,
      [slug],
    )
  }
  finally {
    owner.release()
  }
  const client = await authPool.connect()
  try {
    await client.query('begin')
    await client.query(
      `delete from auth.session where user_id in (select id from auth."user" where lower(email) = any($1::text[]))`,
      [emails],
    )
    await client.query(
      `delete from auth.account where user_id in (select id from auth."user" where lower(email) = any($1::text[]))`,
      [emails],
    )
    await client.query(
      `delete from auth.member
       where organization_id in (select id from auth.organization where slug = $1)
          or user_id in (select id from auth."user" where lower(email) = any($2::text[]))`,
      [slug, emails],
    )
    await client.query(
      `delete from auth.invitation where organization_id in (select id from auth.organization where slug = $1)`,
      [slug],
    )
    await client.query('delete from auth.organization where slug = $1', [slug])
    await client.query('delete from auth."user" where lower(email) = any($1::text[])', [emails])
    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}
