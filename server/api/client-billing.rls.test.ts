import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import patchClient from './clients/[id].patch'
import getBilling from './clients/[id]/billing-details.get'
import putBilling from './clients/[id]/billing-details.put'

/**
 * Billing details through the route handlers (ADR-0051). An invalid body is
 * answered before a session exists. The role cases use a real sign-in.
 * The slug prefix is `hcb-` so cleanup does not touch the note suite's `hcn-` firms.
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
const password = 'billing-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const missingId = '9e4b3f6d-5555-4555-8555-555555555555'
const legalName = 'Hotel Jadran d.o.o.'
const body = {
  legalName,
  country: 'HR',
  oib: '12345678903',
  vatId: null,
  address: 'Obala 1, Split',
  guestNameOnInvoice: false,
}

const app = createApp()
app.use('/api/clients', (event) => {
  const rest = event.path === '/' ? '' : decodeURIComponent(event.path.slice(1))
  const parts = rest.split('/').filter(part => part !== '')
  const id = parts[0] ?? ''
  if (parts[1] === 'billing-details' && parts.length === 2) {
    event.context.params = { id }
    if (event.method === 'PUT')
      return putBilling(event)
    return getBilling(event)
  }
  if (parts.length === 1 && event.method === 'PATCH') {
    event.context.params = { id }
    return patchClient(event)
  }
  throw new Error(`unmapped ${event.method} ${event.path}`)
})
const callClients = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.client_billing_details where tenant_id::text in (
      select id from auth.organization where slug like 'hcb-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hcb-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hcb-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hcb-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hcb-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hcb-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hcb-%'`)
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

function call(method: string, path: string, session?: Headers, payload?: unknown) {
  const headers = new Headers(session)
  if (payload !== undefined)
    headers.set('content-type', 'application/json')
  return callClients(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }))
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text = 'billing_details.saved'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function clientVersion(clientId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    'select version from app.clients where id = $1',
    [clientId],
  )
  const version = result.rows[0]?.version
  if (version === undefined)
    throw new Error('missing client')
  return version
}

async function billingVersion(clientId: string): Promise<number | null> {
  const result = await ownerPool.query<{ version: number }>(
    'select version from app.client_billing_details where client_id = $1',
    [clientId],
  )
  return result.rows[0]?.version ?? null
}

async function office(slug: string) {
  const created = await tenant(slug, 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'Drago Driver', 'driver')
  const admin = await signIn(`${slug}-admin@example.test`)
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const driver = await signIn(`${slug}-driver@example.test`)
  const added = await ownerPool.query<{ id: string }>(
    `insert into app.clients (tenant_id, name, kind) values ($1, 'Hotel Jadran', 'hotel') returning id`,
    [created.tenantId],
  )
  const id = added.rows[0]?.id
  if (!id)
    throw new Error('missing client')
  return { created, dispatcherId, admin, dispatcher, driver, clientId: id }
}

it('answers 400 for a bad body or a bad id, and 401 when nobody is signed in', async () => {
  const path = `/api/clients/${missingId}/billing-details`
  expect((await call('PUT', path, undefined, {})).status).toBe(400)
  expect((await call('PUT', path, undefined, { ...body, oib: null })).status).toBe(400)
  expect((await call('PUT', path, undefined, { ...body, version: -1 })).status).toBe(400)
  const unknown = await call('PUT', path, undefined, { ...body, legalNameSecret: legalName })
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).not.toContain(legalName)
  expect((await call('PUT', '/api/clients/not-a-uuid/billing-details', undefined, body)).status).toBe(400)
  expect((await call('GET', '/api/clients/not-a-uuid/billing-details')).status).toBe(400)
  expect((await call('GET', path)).status).toBe(401)
  expect((await call('PUT', path, undefined, body)).status).toBe(401)
})

it('an office member can read and save billing details, a driver is refused, and the Client version stays', async () => {
  const firm = await office('hcb-roles')
  const path = `/api/clients/${firm.clientId}/billing-details`

  expect((await call('GET', path, firm.driver)).status).toBe(403)
  expect((await call('PUT', path, firm.driver, body)).status).toBe(403)
  expect(await clientVersion(firm.clientId)).toBe(0)
  expect(await billingVersion(firm.clientId)).toBeNull()

  const empty = await call('GET', path, firm.dispatcher)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toMatchObject({
    clientId: firm.clientId,
    legalName: null,
    complete: false,
    version: null,
  })

  const added = await call('PUT', path, firm.dispatcher, {
    ...body,
    legalName: `  ${legalName}  `,
    country: 'hr',
  })
  expect(added.status).toBe(200)
  const first = await added.json() as { version: number, changedByName: string | null, complete: boolean, legalName: string }
  expect(first).toMatchObject({
    clientId: firm.clientId,
    legalName,
    complete: true,
    version: 1,
    changedByName: 'Dino Dispatcher',
  })
  expect(await clientVersion(firm.clientId)).toBe(0)

  const same = await call('PUT', path, firm.admin, { ...body, version: 1 })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(first)
  expect(await auditRows(firm.created.tenantId)).toEqual([
    {
      action: 'billing_details.saved',
      subject_user_id: null,
      data: { clientId: firm.clientId, fields: ['legalName', 'country', 'oib', 'address'] },
    },
  ])

  const corrected = await call('PUT', path, firm.admin, { ...body, address: 'Obala 2, Split', version: 1 })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({ address: 'Obala 2, Split', version: 2, complete: true })
  expect(await clientVersion(firm.clientId)).toBe(0)

  const patched = await call('PATCH', `/api/clients/${firm.clientId}`, firm.admin, {
    name: 'Hotel Jadran izmjena',
    version: 0,
  })
  expect(patched.status).toBe(200)
  expect(await clientVersion(firm.clientId)).toBe(1)
  expect(await billingVersion(firm.clientId)).toBe(2)

  expect((await call('GET', `/api/clients/${missingId}/billing-details`, firm.admin)).status).toBe(404)
  expect((await call('PUT', `/api/clients/${missingId}/billing-details`, firm.admin, body)).status).toBe(404)

  const rows = await auditRows(firm.created.tenantId)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(legalName)
  expect(text).not.toContain('12345678903')
  expect(text).not.toContain('Obala')
  expect(text).not.toContain('Dino Dispatcher')
})

it('refuses a stale correction, writes nothing, and leaves who and when on the row', async () => {
  const firm = await office('hcb-stale')
  const path = `/api/clients/${firm.clientId}/billing-details`
  const added = await call('PUT', path, firm.dispatcher, body)
  expect(added.status).toBe(200)
  const saved = await call('PUT', path, firm.dispatcher, { ...body, address: 'Obala 2, Split', version: 1 })
  expect(saved.status).toBe(200)
  const current = await saved.json()
  const before = await auditRows(firm.created.tenantId)

  const stale = await call('PUT', path, firm.admin, { ...body, legalName: 'Skriveni naziv', version: 1 })
  expect(stale.status).toBe(409)
  const text = await stale.text()
  expect(text).toContain('stale_save')
  expect(text).not.toContain('Skriveni naziv')
  expect(text).not.toContain('Dino Dispatcher')
  expect(await auditRows(firm.created.tenantId)).toEqual(before)
  expect(await clientVersion(firm.clientId)).toBe(0)
  expect(await call('GET', path, firm.admin).then(response => response.json())).toEqual(current)
})

it('another Tenant cannot read or write this Client\'s billing details', async () => {
  const first = await office('hcb-a')
  const second = await office('hcb-b')
  const path = `/api/clients/${first.clientId}/billing-details`
  expect((await call('PUT', path, first.admin, body)).status).toBe(200)
  expect((await call('GET', path, second.admin)).status).toBe(404)
  expect((await call('PUT', path, second.admin, { ...body, legalName: 'Tuđi naziv' })).status).toBe(404)
  expect((await call('PUT', path, second.admin, { ...body, legalName: 'Tuđi naziv', version: 1 })).status).toBe(404)
  const kept = await call('GET', path, first.dispatcher)
  expect(await kept.json()).toMatchObject({ clientId: first.clientId, legalName, version: 1 })
  expect(await billingVersion(second.clientId)).toBeNull()
})
