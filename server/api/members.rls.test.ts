import type { H3Event } from 'h3'
import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getMembers from './members.get'
import deleteMember from './members/[userId].delete'
import patchMemberRole from './members/[userId]/role.patch'

/**
 * GET /api/members, PATCH /api/members/:userId/role, and DELETE /api/members/:userId.
 * A Dispatcher may list members because the Drivers screen loads that list
 * outside Settings. Changing a role and removing a member stay Admin-only,
 * so a Dispatcher receives 403 from those two routes.
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
const password = 'members-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/members', (event) => {
  const parts = memberPath(event)
  if (parts.length === 0 && event.method === 'GET')
    return getMembers(event)
  const userId = decodeURIComponent(parts[0] ?? '')
  // Nitro would set this from the route. The test app is not Nitro.
  event.context.params = { userId }
  if (parts.length === 2 && parts[1] === 'role' && event.method === 'PATCH')
    return patchMemberRole(event)
  if (parts.length === 1 && event.method === 'DELETE')
    return deleteMember(event)
  return new Response('Not Found', { status: 404 })
})
const callMembers = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hmr-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hmr-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hmr-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hmr-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hmr-%'`)
    await auth.query('commit')
  }
  catch (error) {
    await owner.query('rollback')
    await auth.query('rollback')
    throw error
  }
  finally {
    owner.release()
    auth.release()
  }
})

afterAll(async () => {
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
})

function memberPath(event: H3Event): string[] {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '') || '/'
  const marker = '/api/members'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly
  return relative.split('/').filter(part => part !== '')
}

async function tenant(slug: string, adminName: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
}

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<string> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, name, email],
  )
  await authPool.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(password)],
  )
  await authPool.query(
    `insert into auth.member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), tenantId, userId, role],
  )
  return userId
}

async function signIn(email: string): Promise<Headers> {
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  return new Headers({ cookie: response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callMembers(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

it('a dispatcher lists members and a driver is refused', async () => {
  const created = await tenant('hmr-list', 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, 'hmr-list-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverId = await addMember(created.tenantId, 'hmr-list-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('hmr-list-dispatcher@example.test')
  const driver = await signIn('hmr-list-driver@example.test')

  const listed = await call('GET', '/api/members', dispatcher)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({
    members: [
      { userId: dispatcherId, name: 'Dino Dispatcher', role: 'dispatcher' },
      { userId: driverId, name: 'Drago Driver', role: 'driver' },
      { userId: created.adminUserId, name: 'Hana Admin', role: 'admin' },
    ],
  })

  const refused = await call('GET', '/api/members', driver)
  expect(refused.status).toBe(403)
  const text = await refused.text()
  expect(text).not.toContain('hmr-list-admin@example.test')
  expect(text).not.toContain('hmr-list-dispatcher@example.test')
  expect(text).not.toContain('hmr-list-driver@example.test')
})

it('a dispatcher cannot change a role or remove a member', async () => {
  const created = await tenant('hmr-change', 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, 'hmr-change-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverId = await addMember(created.tenantId, 'hmr-change-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('hmr-change-dispatcher@example.test')
  const unchanged = {
    members: [
      { userId: dispatcherId, name: 'Dino Dispatcher', role: 'dispatcher' },
      { userId: driverId, name: 'Drago Driver', role: 'driver' },
      { userId: created.adminUserId, name: 'Hana Admin', role: 'admin' },
    ],
  }

  const role = await call('PATCH', `/api/members/${driverId}/role`, dispatcher, { role: 'dispatcher' })
  expect(role.status).toBe(403)
  expect(await role.text()).not.toContain('hmr-change-driver@example.test')

  const removed = await call('DELETE', `/api/members/${driverId}`, dispatcher)
  expect(removed.status).toBe(403)
  expect(await removed.text()).not.toContain('hmr-change-driver@example.test')

  const listed = await call('GET', '/api/members', dispatcher)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual(unchanged)
})
