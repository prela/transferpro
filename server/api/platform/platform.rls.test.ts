import type { TenantRole } from '../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { configureLogger } from '../../core/index'
import { closePlatformRuntime, createSuperadmin, renameTenantAccount } from '../../modules/platform'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../modules/tenancy'
import getClients from '../clients.get'
import getSession from '../session.get'
import getPlatformSession from './session.get'
import getTenant from './tenants/[id].get'
import patchTenant from './tenants/[id].patch'
import getTenants from './tenants/index.get'

/**
 * Platform routes. A tenant role is answered before the id is parsed or looked up.
 * A superadmin does not receive a tenant session, and an open firm is metadata only.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')
configureLogger('info')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const authUrl = required('BETTER_AUTH_URL')
const password = 'platform-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

const platform = createApp()
platform.use('/api/platform', (event) => {
  const path = event.path.replace(/^\/api\/platform/, '')
  if (path === '/session' || path === '/session/')
    return getPlatformSession(event)
  if (path === '/tenants' || path === '/tenants/')
    return getTenants(event)
  const match = /^\/tenants\/([^/]+)$/.exec(path)
  if (!match)
    return undefined
  event.context.params = { id: decodeURIComponent(match[1] ?? '') }
  if (event.method === 'PATCH')
    return patchTenant(event)
  return getTenant(event)
})
const callPlatform = toWebHandler(platform)

const tenantApp = createApp()
tenantApp.use('/api/session', event => getSession(event))
tenantApp.use('/api/clients', event => getClients(event))
const callTenant = toWebHandler(tenantApp)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hpl-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hpl-%'
    )`)
    await owner.query(`delete from platform.tenant_account where organization_id in (
      select id from auth.organization where slug like 'hpl-%'
    )`)
    await owner.query(`delete from platform.superadmin where user_id in (
      select id from auth."user" where email like 'hpl-%@example.test'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (
      select id from auth."user" where email like 'hpl-%@example.test'
    )`)
    await auth.query(`delete from auth.member where organization_id in (
      select id from auth.organization where slug like 'hpl-%'
    )`)
    await auth.query(`delete from auth."user" where email like 'hpl-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hpl-%'`)
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
  await closePlatformRuntime()
  await closeTenantRuntime()
  await authPool.end()
  await ownerPool.end()
})

async function firm(slug: string) {
  const adminEmail = `${slug}-admin@example.test`
  const created = await createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail,
    adminName: `Admin ${slug}`,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  return { ...created, adminEmail }
}

async function addMember(tenantId: string, email: string, role: TenantRole): Promise<void> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, role, email],
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
}

async function addUser(email: string): Promise<void> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Nobody', $2, true, now(), now())`,
    [userId, email],
  )
  await authPool.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), userId, await hashPassword(password)],
  )
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
  return callPlatform(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function superadmin(email: string): Promise<Headers> {
  await createSuperadmin({
    name: 'Platform Http',
    email,
    password,
    migrateDatabaseUrl,
  })
  return signIn(email)
}

it('answers 401 when there is no session', async () => {
  expect((await call('GET', '/api/platform/session')).status).toBe(401)
  expect((await call('GET', '/api/platform/tenants')).status).toBe(401)
  expect((await call('GET', '/api/platform/tenants/not-a-uuid')).status).toBe(401)
  expect((await call('PATCH', '/api/platform/tenants/not-a-uuid', undefined, { name: 'Mora' })).status).toBe(401)
})

it('answers a tenant admin, dispatcher, driver, and outsider with 403 before lookup', async () => {
  const created = await firm('hpl-gate')
  await addMember(created.tenantId, 'hpl-gate-dispatcher@example.test', 'dispatcher')
  await addMember(created.tenantId, 'hpl-gate-driver@example.test', 'driver')
  await addUser('hpl-gate-none@example.test')
  const unknown = '00000000-0000-4000-8000-000000000000'
  for (const email of [
    created.adminEmail,
    'hpl-gate-dispatcher@example.test',
    'hpl-gate-driver@example.test',
    'hpl-gate-none@example.test',
  ]) {
    const session = await signIn(email)
    expect((await call('GET', '/api/platform/session', session)).status).toBe(403)
    expect((await call('GET', '/api/platform/tenants', session)).status).toBe(403)
    expect((await call('GET', '/api/platform/tenants/not-a-uuid', session)).status).toBe(403)
    expect((await call('GET', `/api/platform/tenants/${unknown}`, session)).status).toBe(403)
    expect((await call('PATCH', `/api/platform/tenants/${unknown}`, session, { name: 'Renamed' })).status).toBe(403)
    expect((await call('PATCH', '/api/platform/tenants/not-a-uuid', session, { name: 'Renamed' })).status).toBe(403)
  }
})

it('gives a superadmin no tenant session and only firm metadata', async () => {
  const created = await firm('hpl-open')
  const planted = 'PlantedClientHpl'
  await ownerPool.query(
    `insert into app.clients (tenant_id, name, kind) values ($1, $2, 'agency')`,
    [created.tenantId, planted],
  )
  const session = await superadmin('hpl-owner-open@example.test')
  const tenantSession = await callTenant(new Request('http://localhost/api/session', { headers: session }))
  expect(tenantSession.status).toBe(403)
  const clients = await callTenant(new Request('http://localhost/api/clients', { headers: session }))
  expect(clients.status).toBe(403)
  expect(await clients.text()).not.toContain(planted)

  const shell = await call('GET', '/api/platform/session', session)
  expect(shell.status).toBe(200)
  expect(Object.keys(await shell.json() as object).sort()).toEqual(['locale', 'timeZone', 'userId'])

  const opened = await call('GET', `/api/platform/tenants/${created.tenantId}`, session)
  expect(opened.status).toBe(200)
  const body = await opened.json() as Record<string, unknown>
  expect(Object.keys(body).sort()).toEqual(['active', 'createdAt', 'id', 'name', 'slug'])
  expect(body).toMatchObject({ id: created.tenantId, name: 'Tenant hpl-open', slug: 'hpl-open', active: true })
  expect(JSON.stringify(body)).not.toContain(planted)
  expect(JSON.stringify(body)).not.toContain('memberCount')

  expect((await call('GET', '/api/platform/tenants/not-a-uuid', session)).status).toBe(400)
  expect((await call('GET', '/api/platform/tenants/00000000-0000-4000-8000-000000000000', session)).status).toBe(404)
  const echoed = await call('PATCH', `/api/platform/tenants/${created.tenantId}`, session, {
    name: 'Still Mora',
    email: 'secret-hpl@example.test',
  })
  expect(echoed.status).toBe(400)
  expect(await echoed.text()).not.toContain('secret-hpl@example.test')
})

it('audits a real rename and skips a no-op', async () => {
  const first = await firm('hpl-order-b')
  const second = await firm('hpl-order-a')
  const session = await superadmin('hpl-owner-rename@example.test')
  const owner = await ownerPool.query<{ id: string }>(
    'select id from auth."user" where email = $1',
    ['hpl-owner-rename@example.test'],
  )
  const actor = owner.rows[0]?.id
  expect(actor).toBeTruthy()

  const before = await audit(first.tenantId)
  const same = await renameTenantAccount(session, first.tenantId, { name: 'Tenant hpl-order-b' })
  expect(same.name).toBe('Tenant hpl-order-b')
  expect(await audit(first.tenantId)).toEqual(before)

  const renamed = await call('PATCH', `/api/platform/tenants/${first.tenantId}`, session, { name: 'Same Name Hpl' })
  expect(renamed.status).toBe(200)
  await call('PATCH', `/api/platform/tenants/${second.tenantId}`, session, { name: 'Same Name Hpl' })
  const rows = await audit(first.tenantId)
  expect(rows).toEqual([
    { action: 'tenant.renamed', actor_user_id: actor, subject_user_id: null, data: {} },
  ])
  expect(JSON.stringify(rows)).not.toContain('Same Name Hpl')

  const listed = await call('GET', '/api/platform/tenants', session)
  const accounts = ((await listed.json()) as { accounts: Array<{ name: string, slug: string }> }).accounts.filter(account => account.slug.startsWith('hpl-order-'))
  expect(accounts.map(account => account.slug)).toEqual(['hpl-order-a', 'hpl-order-b'])
})

async function audit(tenantId: string) {
  const result = await ownerPool.query<{ action: string, actor_user_id: string, subject_user_id: string | null, data: unknown }>(
    `select action, actor_user_id, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text = 'tenant.renamed'
     order by occurred_at`,
    [tenantId],
  )
  return result.rows
}
