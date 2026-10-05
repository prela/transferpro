import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getLocations from './locations.get'
import postLocation from './locations.post'
import patchLocation from './locations/[id].patch'
import archiveLocation from './locations/[id]/archive.post'

/**
 * GET, POST, PATCH /api/locations, and POST /api/locations/:id/archive.
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
const password = 'locations-http-password'
const place = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/locations', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (rest === '') {
    if (event.method === 'POST')
      return postLocation(event)
    return getLocations(event)
  }
  const [id, action] = rest.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'archive')
    return archiveLocation(event)
  return patchLocation(event)
})
const callLocations = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hlc-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hlc-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hlc-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hlc-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hlc-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hlc-%'`)
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

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callLocations(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function locationBody(overrides: Record<string, unknown> = {}) {
  return {
    name: place,
    kind: 'airport',
    address,
    ...overrides,
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'location.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for a bad body and does not echo the address, and no session is 401', async () => {
  const refused = await call('POST', '/api/locations', undefined, { name: ' ', kind: 'airport', address })
  expect(refused.status).toBe(400)
  expect(await refused.text()).not.toContain(address)
  expect((await call('GET', '/api/locations')).status).toBe(401)
  expect((await call('GET', '/api/locations?includeArchived=maybe')).status).toBe(400)
  expect((await call('GET', '/api/locations?includeArchived=')).status).toBe(400)
  expect((await call('GET', '/api/locations?includeArchived=false')).status).toBe(401)
  expect((await call('PATCH', '/api/locations/not-a-uuid', undefined, { name: place })).status).toBe(400)
})

it('a dispatcher and an admin can add, correct, list, and archive a Location, and a driver is refused', async () => {
  const created = await tenant('hlc-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hlc-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hlc-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hlc-roles-admin@example.test')
  const dispatcher = await signIn('hlc-roles-dispatcher@example.test')
  const driver = await signIn('hlc-roles-driver@example.test')

  const refused = await call('POST', '/api/locations', driver, locationBody({ name: 'Skriveno' }))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(address)
  expect((await call('GET', '/api/locations', driver)).status).toBe(403)
  expect((await call('PATCH', '/api/locations/a1b2c3d4-5555-4555-8555-555555555555', driver, { kind: 'hotel' })).status).toBe(403)
  expect((await call('POST', '/api/locations/a1b2c3d4-5555-4555-8555-555555555555/archive', driver)).status).toBe(403)

  const added = await call('POST', '/api/locations', dispatcher, locationBody({ name: `  ${place}  `, address: `  ${address}  ` }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row).toEqual({
    id: expect.any(String),
    name: place,
    kind: 'airport',
    address,
    archivedAt: null,
  })

  const listed = await call('GET', '/api/locations', admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ locations: [row] })

  const same = await call('PATCH', `/api/locations/${row.id}`, dispatcher, { name: place })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(row)

  const corrected = await call('PATCH', `/api/locations/${row.id}`, admin, {
    name: 'Hotel Excelsior',
    kind: 'hotel',
    address: null,
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    id: row.id,
    name: 'Hotel Excelsior',
    kind: 'hotel',
    address: null,
    archivedAt: null,
  })

  expect((await call('PATCH', `/api/locations/${row.id}`, driver, { kind: 'other' })).status).toBe(403)
  expect((await call('POST', `/api/locations/${row.id}/archive`, driver)).status).toBe(403)
  const untouched = await call('GET', '/api/locations', admin)
  expect(await untouched.json()).toEqual({
    locations: [expect.objectContaining({
      id: row.id,
      name: 'Hotel Excelsior',
      kind: 'hotel',
      address: null,
      archivedAt: null,
    })],
  })

  const archived = await call('POST', `/api/locations/${row.id}/archive`, dispatcher)
  expect(archived.status).toBe(200)
  const archivedRow = await archived.json()
  expect(archivedRow.archivedAt).toEqual(expect.any(String))

  const frozen = await call('PATCH', `/api/locations/${row.id}`, admin, { kind: 'address' })
  expect(frozen.status).toBe(409)
  const frozenText = await frozen.text()
  expect(frozenText).not.toContain('Hotel Excelsior')
  expect(frozenText).not.toContain(address)

  const hidden = await call('GET', '/api/locations', dispatcher)
  expect(await hidden.json()).toEqual({ locations: [] })

  const withArchived = await call('GET', '/api/locations?includeArchived=true', admin)
  expect(await withArchived.json()).toEqual({
    locations: [expect.objectContaining({
      id: row.id,
      name: 'Hotel Excelsior',
      kind: 'hotel',
      address: null,
      archivedAt: expect.any(String),
    })],
  })

  const again = await call('POST', `/api/locations/${row.id}/archive`, admin)
  expect(again.status).toBe(200)
  expect((await again.json()).archivedAt).toBe(archivedRow.archivedAt)

  const missing = 'a1b2c3d4-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/locations/${missing}`, admin, { kind: 'other' })).status).toBe(404)
  expect((await call('POST', `/api/locations/${missing}/archive`, admin)).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(place)
  expect(text).not.toContain(address)
  expect(text).not.toContain('Hotel Excelsior')
  expect(rows.map(entry => entry.action)).toContain('location.created')
  expect(rows.map(entry => entry.action)).toContain('location.archived')
  const fieldChanges = rows.filter(entry => entry.action === 'location.field_changed').map(entry => entry.data)
  expect(fieldChanges).toHaveLength(3)
  expect(fieldChanges).toEqual(expect.arrayContaining([
    { locationId: row.id, field: 'name' },
    { locationId: row.id, field: 'kind' },
    { locationId: row.id, field: 'address' },
  ]))
  const createdEntry = rows.find(entry => entry.action === 'location.created')
  expect(createdEntry?.data).toEqual({
    locationId: row.id,
    fields: ['name', 'kind', 'address'],
  })
})

it('another Tenant cannot read or change these Locations', async () => {
  await tenant('hlc-iso-a', 'Ana Admin')
  await tenant('hlc-iso-b', 'Boris Admin')
  const adminA = await signIn('hlc-iso-a-admin@example.test')
  const adminB = await signIn('hlc-iso-b-admin@example.test')

  const added = await call('POST', '/api/locations', adminA, locationBody({ name: 'Hotel Park', address: null }))
  expect(added.status).toBe(200)
  const row = await added.json()

  expect(await (await call('GET', '/api/locations', adminB)).json()).toEqual({ locations: [] })
  expect((await call('GET', '/api/locations?includeArchived=true', adminB)).status).toBe(200)
  expect(await (await call('GET', '/api/locations?includeArchived=true', adminB)).json()).toEqual({ locations: [] })
  expect((await call('PATCH', `/api/locations/${row.id}`, adminB, { kind: 'other' })).status).toBe(404)
  expect((await call('POST', `/api/locations/${row.id}/archive`, adminB)).status).toBe(404)
  expect(await (await call('GET', '/api/locations', adminA)).json()).toEqual({
    locations: [expect.objectContaining({ id: row.id, name: 'Hotel Park' })],
  })
})
