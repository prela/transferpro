import { loadEnvFile } from 'node:process'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { inviteResultSchema, memberListSchema } from '../../../shared'
import { closeTenantRuntime, createTenant, handleAuthRequest, removeTenantMember } from '../../modules/tenancy'
import listMembers from '../members.get'
import acceptInvitationRoute from './accept.post'
import postInvitation from './index.post'

/**
 * POST /api/invitations and POST /api/invitations/accept, through the routes.
 * A new-account accept used to answer with a bare session cookie. The browser
 * stored it on /api/invitations, and that copy hid the admin's Path=/ session.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const authUrl = required('BETTER_AUTH_URL')
const password = 'invite-cookie-password'
const adminEmail = 'iac-admin@example.test'
const newEmail = 'iac-new@example.test'
const pendingEmail = 'iac-pending@example.test'
const slug = 'iac-cookie'

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

function web(handler: (event: Parameters<typeof postInvitation>[0]) => Promise<unknown>) {
  const app = createApp()
  app.use(handler)
  return toWebHandler(app)
}

const invite = web(postInvitation)
const accept = web(acceptInvitationRoute)
const members = web(listMembers)

let adminCookie = ''

beforeAll(async () => {
  await removeFixture()
  await createTenant({
    name: 'Invite cookie',
    slug,
    adminEmail,
    adminName: 'Iva Admin',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  adminCookie = await signIn(adminEmail)
})

afterAll(async () => {
  await removeFixture()
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
})

it('keeps the admin session after a new account accepts and is removed', async () => {
  const created = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: newEmail,
    role: 'driver',
  })
  expect(created.status).toBe(200)
  expectShadowClear(created)
  const invitationId = new URL(inviteResultSchema.parse(await created.json()).inviteUrl).hash.slice(1)

  const accepted = await call(accept, 'POST', '/api/invitations/accept', '', {
    invitationId,
    name: 'Neda New',
    password,
  })
  expect(accepted.status).toBe(200)
  const sessionCookie = sessionSetCookie(accepted.headers.getSetCookie())
  const attributes = sessionCookie.split(';').slice(1).map(part => part.trim())
  expect(attributes).toContain('Path=/')
  expect(attributes).toContain('HttpOnly')
  expect(attributes).toContain('SameSite=Lax')
  expectShadowClear(accepted)

  const listed = await call(members, 'GET', '/api/members', adminCookie)
  expect(listed.status).toBe(200)
  const member = memberListSchema.parse(await listed.json()).members.find(row => row.name === 'Neda New')
  if (member === undefined)
    throw new Error('accepted member is missing')
  await removeTenantMember(new Headers({ cookie: adminCookie }), member.userId)

  const poisoned = `${sessionCookie.split(';')[0]?.trim()}; ${adminCookie}`
  const again = await call(invite, 'POST', '/api/invitations', poisoned, {
    email: 'iac-later@example.test',
    role: 'driver',
  })
  expect(again.status).toBe(200)
  expectShadowClear(again)
  expect(inviteResultSchema.parse(await again.json()).inviteUrl).toMatch(/#[0-9a-f-]{36}$/)
})

it('answers 409 for a member and a pending invitation, and 200 after that member is removed', async () => {
  const member = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: adminEmail,
    role: 'driver',
  })
  expect(member.status).toBe(409)

  const first = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: pendingEmail,
    role: 'driver',
  })
  expect(first.status).toBe(200)
  await first.json()
  const second = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: pendingEmail,
    role: 'dispatcher',
  })
  expect(second.status).toBe(409)

  const invited = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: 'iac-reinvite@example.test',
    role: 'driver',
  })
  expect(invited.status).toBe(200)
  const invitationId = new URL(inviteResultSchema.parse(await invited.json()).inviteUrl).hash.slice(1)
  const accepted = await call(accept, 'POST', '/api/invitations/accept', '', {
    invitationId,
    name: 'Roko Removed',
    password,
  })
  expect(accepted.status).toBe(200)
  await accepted.json()
  const listed = await call(members, 'GET', '/api/members', adminCookie)
  const row = memberListSchema.parse(await listed.json()).members.find(item => item.name === 'Roko Removed')
  if (row === undefined)
    throw new Error('reinvite member is missing')
  await removeTenantMember(new Headers({ cookie: adminCookie }), row.userId)

  const restored = await call(invite, 'POST', '/api/invitations', adminCookie, {
    email: 'iac-reinvite@example.test',
    role: 'dispatcher',
  })
  expect(restored.status).toBe(200)
  expect(inviteResultSchema.parse(await restored.json()).inviteUrl).toMatch(/#[0-9a-f-]{36}$/)
})

function sessionSetCookie(cookies: readonly string[]): string {
  const session = cookies.find(part => part.includes('session_token') && !part.includes('Max-Age=0'))
  if (session === undefined)
    throw new Error('accept did not set a session cookie')
  return session
}

/** Expires the path-scoped copy only. Path=/ would clear the real session. */
function expectShadowClear(response: Response): void {
  const expiring = response.headers.getSetCookie().filter(part => part.includes('Max-Age=0'))
  expect(expiring).toHaveLength(1)
  const clear = expiring[0] ?? ''
  expect(clear).toMatch(/^[\w.-]+=; Path=\/api\/invitations; Max-Age=0$/)
  expect(clear).not.toMatch(/Path=\/(?:;|$)/)
}

function call(
  handler: (request: Request) => Response | Promise<Response>,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  const headers = new Headers()
  if (cookie !== '')
    headers.set('cookie', cookie)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return handler(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function signIn(email: string): Promise<string> {
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  const cookie = response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ')
  if (!cookie.includes('session_token'))
    throw new Error('sign-in did not set a session cookie')
  return cookie
}

async function removeFixture() {
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
  const emails = [adminEmail, newEmail, pendingEmail, 'iac-later@example.test', 'iac-reinvite@example.test']
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
