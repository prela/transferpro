import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getClients from './clients.get'
import postClient from './clients.post'
import patchClient from './clients/[id].patch'

/**
 * GET, POST, and PATCH /api/clients, through the route handlers.
 * An invalid body is answered before a session exists. The role cases use
 * a real sign-in, the same way the screen will call these routes.
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
const password = 'clients-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
// h3 mounts `/api/clients` as a prefix, so `/api/clients/:id` is `event.path`
// `/<id>` here. Nitro sets that param from the file route; this test does too.
app.use('/api/clients', (event) => {
  const id = event.path === '/' ? '' : decodeURIComponent(event.path.slice(1))
  if (id === '') {
    if (event.method === 'POST')
      return postClient(event)
    return getClients(event)
  }
  event.context.params = { id }
  return patchClient(event)
})
const callClients = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hcl-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hcl-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hcl-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hcl-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hcl-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hcl-%'`)
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

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<void> {
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
  return callClients(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'client.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for an empty name, an unknown kind, or an unknown key, and does not echo the key', async () => {
  expect((await call('POST', '/api/clients', undefined, { name: '   ', kind: 'agency' })).status).toBe(400)
  expect((await call('POST', '/api/clients', undefined, { name: 'Mora', kind: 'partner' })).status).toBe(400)
  expect((await call('POST', '/api/clients', undefined, { name: 'A'.repeat(201), kind: 'hotel' })).status).toBe(400)
  const unknown = await call('POST', '/api/clients', undefined, { name: 'Mora', kind: 'agency', email: 'ana@example.test' })
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).not.toContain('ana@example.test')
  expect((await call('PATCH', '/api/clients/not-a-uuid', undefined, { name: 'Mora' })).status).toBe(400)
  expect((await call('GET', '/api/clients')).status).toBe(401)
  expect((await call('POST', '/api/clients', undefined, { name: 'Mora', kind: 'agency' })).status).toBe(401)
  expect((await call('PATCH', '/api/clients/9e4b3f6d-5555-4555-8555-555555555555', undefined, { kind: 'hotel' })).status).toBe(401)
})

it('a dispatcher and an admin can add, correct, and list a Client, and a driver is refused', async () => {
  const created = await tenant('hcl-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hcl-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hcl-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hcl-roles-admin@example.test')
  const dispatcher = await signIn('hcl-roles-dispatcher@example.test')
  const driver = await signIn('hcl-roles-driver@example.test')

  expect((await call('GET', '/api/clients', driver)).status).toBe(403)
  expect((await call('POST', '/api/clients', driver, { name: 'Hidden', kind: 'hotel' })).status).toBe(403)

  const added = await call('POST', '/api/clients', dispatcher, { name: '  Agencija Mora  ', kind: 'agency' })
  expect(added.status).toBe(200)
  const client = await added.json()
  expect(client).toEqual({ id: expect.any(String), name: 'Agencija Mora', kind: 'agency' })

  const listed = await call('GET', '/api/clients', admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ clients: [client] })

  const same = await call('PATCH', `/api/clients/${client.id}`, dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(client)

  const corrected = await call('PATCH', `/api/clients/${client.id}`, admin, { name: 'Mora d.o.o.', kind: 'hotel' })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toEqual({ id: client.id, name: 'Mora d.o.o.', kind: 'hotel' })

  expect((await call('PATCH', `/api/clients/${client.id}`, driver, { name: 'Nope' })).status).toBe(403)
  const still = await call('GET', '/api/clients', dispatcher)
  expect(await still.json()).toEqual({ clients: [{ id: client.id, name: 'Mora d.o.o.', kind: 'hotel' }] })

  const missing = '9e4b3f6d-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/clients/${missing}`, admin, { kind: 'individual' })).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  const byAction = new Map(rows.map(row => [row.action, row]))
  expect([...byAction.keys()].sort()).toEqual(['client.created', 'client.kind_changed', 'client.name_changed'])
  expect(rows.every(row => row.subject_user_id === null)).toBe(true)
  expect(byAction.get('client.created')?.data).toEqual({ clientId: client.id, kind: 'agency' })
  expect(byAction.get('client.kind_changed')?.data).toEqual({ clientId: client.id, from: 'agency', to: 'hotel' })
  expect(byAction.get('client.name_changed')?.data).toEqual({ clientId: client.id })
  expect(JSON.stringify(rows)).not.toContain('Agencija Mora')
  expect(JSON.stringify(rows)).not.toContain('Mora d.o.o.')
})

it('an admin can add a Client and a dispatcher can correct the name', async () => {
  const created = await tenant('hcl-office', 'Iva Admin')
  await addMember(created.tenantId, 'hcl-office-dispatcher@example.test', 'Ivo Dispatcher', 'dispatcher')
  const admin = await signIn('hcl-office-admin@example.test')
  const dispatcher = await signIn('hcl-office-dispatcher@example.test')

  const added = await call('POST', '/api/clients', admin, { name: 'Hotel Park', kind: 'hotel' })
  expect(added.status).toBe(200)
  const client = await added.json()

  const patched = await call('PATCH', `/api/clients/${client.id}`, dispatcher, { name: 'Hotel Park Zagreb' })
  expect(patched.status).toBe(200)
  expect(await patched.json()).toEqual({ id: client.id, name: 'Hotel Park Zagreb', kind: 'hotel' })

  const listed = await call('GET', '/api/clients', dispatcher)
  expect(await listed.json()).toEqual({ clients: [{ id: client.id, name: 'Hotel Park Zagreb', kind: 'hotel' }] })
})

it('another Tenant cannot read or correct this Client', async () => {
  const first = await tenant('hcl-a', 'Ana Admin')
  const second = await tenant('hcl-b', 'Boris Admin')
  const adminA = await signIn('hcl-a-admin@example.test')
  const adminB = await signIn('hcl-b-admin@example.test')

  const added = await call('POST', '/api/clients', adminA, { name: 'Hotel Park', kind: 'hotel' })
  expect(added.status).toBe(200)
  const client = await added.json()

  expect(await (await call('GET', '/api/clients', adminB)).json()).toEqual({ clients: [] })
  expect((await call('PATCH', `/api/clients/${client.id}`, adminB, { name: 'Taken' })).status).toBe(404)

  const kept = await call('GET', '/api/clients', adminA)
  expect(await kept.json()).toEqual({ clients: [client] })
  expect(first.tenantId).not.toBe(second.tenantId)
})
