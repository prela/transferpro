import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { tenantTimeZoneIds } from '../../shared'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getTenantSettings from './tenant-settings.get'
import patchTenantSettings from './tenant-settings.patch'

/**
 * GET and PATCH /api/tenant-settings, through the route handlers.
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
const password = 'tenant-settings-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

function web(handler: (event: Parameters<typeof getTenantSettings>[0]) => Promise<unknown>) {
  const app = createApp()
  app.use(handler)
  return toWebHandler(app)
}

const readSettings = web(getTenantSettings)
const changeSettings = web(patchTenantSettings)

const initial = {
  airportWaitMinutes: 90,
  elsewhereWaitMinutes: 25,
  timeZone: 'Europe/Zagreb',
  operationalDayStartHour: 5,
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hts-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hts-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hts-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hts-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hts-%'`)
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
  return handler(new Request('http://localhost/api/tenant-settings', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

it('patch answers 400 for bad minutes, an unknown zone, or an unknown key, and does not echo the key', async () => {
  expect((await call(changeSettings, 'PATCH', undefined, { airportWaitMinutes: 0 })).status).toBe(400)
  expect((await call(changeSettings, 'PATCH', undefined, { operationalDayStartHour: 9 })).status).toBe(400)
  expect((await call(changeSettings, 'PATCH', undefined, { operationalDayStartHour: 5.5 })).status).toBe(400)
  expect((await call(changeSettings, 'PATCH', undefined, { operationalDayStartHour: 6 })).status).toBe(401)
  expect((await call(readSettings, 'GET')).status).toBe(401)
  expect((await call(changeSettings, 'PATCH', undefined, { timeZone: 'Not/AZone' })).status).toBe(400)
  const unknown = await call(changeSettings, 'PATCH', undefined, { airportWaitMinutes: 90, email: 'ana@example.test' })
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).not.toContain('ana@example.test')
})

it('get and patch answer 200 for an admin, and patch answers 403 for a dispatcher and a driver', async () => {
  const created = await tenant('hts-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hts-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hts-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hts-roles-admin@example.test')
  const dispatcher = await signIn('hts-roles-dispatcher@example.test')
  const driver = await signIn('hts-roles-driver@example.test')

  const got = await call(readSettings, 'GET', admin)
  expect(got.status).toBe(200)
  expect(await got.json()).toEqual({ ...initial, timeZones: [...tenantTimeZoneIds] })

  const patched = await call(changeSettings, 'PATCH', admin, { airportWaitMinutes: 80 })
  expect(patched.status).toBe(200)
  expect(await patched.json()).toEqual({ ...initial, airportWaitMinutes: 80 })

  expect((await call(changeSettings, 'PATCH', dispatcher, { airportWaitMinutes: 81 })).status).toBe(403)
  expect((await call(changeSettings, 'PATCH', driver, { timeZone: 'Europe/Berlin' })).status).toBe(403)
  expect((await call(changeSettings, 'PATCH', dispatcher, { operationalDayStartHour: 6 })).status).toBe(403)
  expect((await call(changeSettings, 'PATCH', driver, { operationalDayStartHour: 0 })).status).toBe(403)

  const still = await call(readSettings, 'GET', dispatcher)
  expect(still.status).toBe(200)
  expect(await still.json()).toEqual({ ...initial, airportWaitMinutes: 80, timeZones: [...tenantTimeZoneIds] })
  expect((await call(readSettings, 'GET', driver)).status).toBe(200)
})

it('get returns the zones the server accepts', async () => {
  await tenant('hts-zones', 'Zora Admin')
  const admin = await signIn('hts-zones-admin@example.test')
  const got = await call(readSettings, 'GET', admin)
  expect(got.status).toBe(200)
  const body = await got.json()
  expect(body.timeZones).toEqual([...tenantTimeZoneIds])
  expect(body.timeZones).toContain('Europe/Zagreb')
  expect(body.timeZones).toContain('UTC')
  expect(body.timeZones).toContain('Etc/UTC')
  expect(body.timeZones).not.toContain('US/Eastern')
  expect(body.timeZones).not.toContain('GMT')
})

it('patch without a time zone succeeds when the stored zone is off the list', async () => {
  const created = await tenant('hts-retired', 'Ruta Admin')
  await ownerPool.query(`update app.tenant_settings set time_zone = 'US/Eastern' where tenant_id = $1`, [created.tenantId])
  const admin = await signIn('hts-retired-admin@example.test')

  const patched = await call(changeSettings, 'PATCH', admin, { airportWaitMinutes: 100 })
  expect(patched.status).toBe(200)
  expect(await patched.json()).toEqual({
    airportWaitMinutes: 100,
    elsewhereWaitMinutes: 25,
    timeZone: 'US/Eastern',
    operationalDayStartHour: 5,
  })

  const got = await call(readSettings, 'GET', admin)
  expect(got.status).toBe(200)
  const body = await got.json()
  expect(body.timeZone).toBe('US/Eastern')
  expect(body.timeZones).not.toContain('US/Eastern')
})
