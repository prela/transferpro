import type { TenantRole } from '../../shared'
import { Buffer } from 'node:buffer'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getInvoicingSettings from './invoicing-settings.get'
import putInvoicingSettings from './invoicing-settings.put'

/**
 * GET and PUT /api/invoicing-settings, through the route handlers.
 * The token is write-only. A dispatcher and a driver are 403 on both.
 * Another Tenant's save does not change this Tenant's row.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

process.env.INVOICING = 'none'
process.env.INVOICING_SECRET_KEY = Buffer.alloc(32, 5).toString('base64')

const token = 'route-token-abcdefgh'

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const password = 'invoicing-settings-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

function web(handler: (event: Parameters<typeof getInvoicingSettings>[0]) => Promise<unknown>) {
  const app = createApp()
  app.use(handler)
  return toWebHandler(app)
}

const readSettings = web(getInvoicingSettings)
const changeSettings = web(putInvoicingSettings)

const defaults = {
  dueDays: 15,
  vatRate: 25,
  lineText: 'Transfer',
  version: 0,
  tokenSet: false,
  tokenLastFour: null,
}

const saveBody = {
  dueDays: 15,
  vatRate: 25,
  lineText: 'Transfer',
  version: 0,
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.invoicing_settings where tenant_id::text in (
      select id from auth.organization where slug like 'invset-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'invset-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'invset-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'invset-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'invset-%'`)
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

function call(handler: (request: Request) => Response | Promise<Response>, method: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return handler(new Request('http://localhost/api/invoicing-settings', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

it('answers 400 for a bad body and does not echo the token', async () => {
  const bad = await call(changeSettings, 'PUT', undefined, { dueDays: 15, vatRate: 25, lineText: 'Transfer', version: 0, token: 'short' })
  expect(bad.status).toBe(400)
  expect(await bad.text()).not.toContain('short')
  expect((await call(readSettings, 'GET')).status).toBe(401)
  expect((await call(changeSettings, 'PUT', undefined, { dueDays: -1, vatRate: 25, lineText: 'Transfer', version: 0 })).status).toBe(400)
  expect((await call(changeSettings, 'PUT', undefined, { dueDays: 15, vatRate: 10, lineText: 'Transfer', version: 0 })).status).toBe(400)
})

it('is admin only, returns the last four characters, and keeps the token out of the response', async () => {
  const created = await tenant('invset-roles', 'Iva Admin')
  await addMember(created.tenantId, 'invset-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'invset-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('invset-roles-admin@example.test')
  const dispatcher = await signIn('invset-roles-dispatcher@example.test')
  const driver = await signIn('invset-roles-driver@example.test')

  expect((await call(readSettings, 'GET', dispatcher)).status).toBe(403)
  expect((await call(readSettings, 'GET', driver)).status).toBe(403)
  expect((await call(changeSettings, 'PUT', dispatcher, { ...saveBody, token })).status).toBe(403)
  expect((await call(changeSettings, 'PUT', driver, { ...saveBody, dueDays: 9 })).status).toBe(403)

  const got = await call(readSettings, 'GET', admin)
  expect(got.status).toBe(200)
  expect(await got.json()).toEqual(defaults)

  const saved = await call(changeSettings, 'PUT', admin, { ...saveBody, dueDays: 10, token })
  expect(saved.status).toBe(200)
  const body = await saved.json()
  expect(body).toEqual({
    dueDays: 10,
    vatRate: 25,
    lineText: 'Transfer',
    version: 1,
    tokenSet: true,
    tokenLastFour: 'efgh',
  })
  expect(JSON.stringify(body)).not.toContain(token)

  const again = await call(changeSettings, 'PUT', admin, { dueDays: 10, vatRate: 25, lineText: 'Transfer', version: 1 })
  expect(again.status).toBe(200)
  expect(await again.json()).toMatchObject({ version: 1, dueDays: 10, tokenLastFour: 'efgh' })
  const quiet = await ownerPool.query(
    `select count(*)::int as n from app.audit_entry where tenant_id = $1 and action::text = 'invoicing_settings.changed'`,
    [created.tenantId],
  )
  expect(quiet.rows[0]?.n).toBe(1)

  const audited = await ownerPool.query<{ data: { fields: string[] } }>(
    `select data from app.audit_entry where tenant_id = $1 and action::text = 'invoicing_settings.changed'`,
    [created.tenantId],
  )
  expect(audited.rows[0]?.data).toEqual({ fields: ['dueDays', 'token'] })
  expect(JSON.stringify(audited.rows)).not.toContain(token)
})

it('does not let one Tenant read or write another Tenant settings', async () => {
  const first = await tenant('invset-a', 'Ana Admin')
  const second = await tenant('invset-b', 'Bara Admin')
  const adminA = await signIn('invset-a-admin@example.test')
  const adminB = await signIn('invset-b-admin@example.test')

  const saved = await call(changeSettings, 'PUT', adminA, { ...saveBody, dueDays: 20, lineText: 'Airport', token })
  expect(saved.status).toBe(200)

  const other = await call(readSettings, 'GET', adminB)
  expect(other.status).toBe(200)
  const otherBody = await other.json()
  expect(otherBody).toEqual(defaults)
  expect(JSON.stringify(otherBody)).not.toContain('efgh')

  const write = await call(changeSettings, 'PUT', adminB, { ...saveBody, dueDays: 3 })
  expect(write.status).toBe(200)

  const row = await ownerPool.query<{ due_days: number, token_last_four: string }>(
    `select due_days, token_last_four from app.invoicing_settings where tenant_id = $1`,
    [first.tenantId],
  )
  expect(row.rows).toEqual([{ due_days: 20, token_last_four: 'efgh' }])
  const otherRow = await ownerPool.query<{ due_days: number }>(
    `select due_days from app.invoicing_settings where tenant_id = $1`,
    [second.tenantId],
  )
  expect(otherRow.rows).toEqual([{ due_days: 3 }])
})
