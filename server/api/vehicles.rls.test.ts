import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getVehicles from './vehicles.get'
import postVehicle from './vehicles.post'
import patchVehicle from './vehicles/[id].patch'
import archiveVehicle from './vehicles/[id]/archive.post'

/**
 * GET, POST, PATCH /api/vehicles, and POST /api/vehicles/:id/archive.
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
const password = 'vehicles-http-password'
const plate = 'DU123AB'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/vehicles', (event) => {
  const pathOnly = event.path.split('?')[0] ?? '/'
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.slice(1))
  if (rest === '') {
    if (event.method === 'POST')
      return postVehicle(event)
    return getVehicles(event)
  }
  const [id, action] = rest.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'archive')
    return archiveVehicle(event)
  return patchVehicle(event)
})
const callVehicles = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hvh-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hvh-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hvh-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hvh-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hvh-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hvh-%'`)
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
  return callVehicles(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function vehicleBody(overrides: Record<string, unknown> = {}) {
  return {
    registrationPlate: plate,
    kind: 'fixed',
    registrationExpiresOn: '2027-06-01',
    technicalInspectionExpiresOn: '2028-01-31',
    insuranceExpiresOn: '2029-03-03',
    ...overrides,
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'vehicle.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('post answers 400 for a bad body and does not echo the plate, and no session is 401', async () => {
  expect((await call('POST', '/api/vehicles', undefined, vehicleBody({ registrationPlate: '   ' }))).status).toBe(400)
  expect((await call('POST', '/api/vehicles', undefined, vehicleBody({ kind: 'own' }))).status).toBe(400)
  expect((await call('POST', '/api/vehicles', undefined, vehicleBody({ registrationExpiresOn: '2026-02-31' }))).status).toBe(400)
  const unknown = await call('POST', '/api/vehicles', undefined, vehicleBody({ name: 'Van' }))
  expect(unknown.status).toBe(400)
  const unknownText = await unknown.text()
  expect(unknownText).not.toContain(plate)
  expect(unknownText).not.toContain('Van')
  expect((await call('PATCH', '/api/vehicles/not-a-uuid', undefined, { kind: 'fixed' })).status).toBe(400)
  expect((await call('GET', '/api/vehicles')).status).toBe(401)
  expect((await call('POST', '/api/vehicles', undefined, vehicleBody())).status).toBe(401)
  expect((await call('PATCH', '/api/vehicles/a1b2c3d4-5555-4555-8555-555555555555', undefined, { kind: 'occasional' })).status).toBe(401)
  expect((await call('POST', '/api/vehicles/a1b2c3d4-5555-4555-8555-555555555555/archive')).status).toBe(401)
  expect((await call('GET', '/api/vehicles?includeArchived=1')).status).toBe(400)
  expect((await call('GET', '/api/vehicles?includeArchived=')).status).toBe(400)
  expect((await call('GET', '/api/vehicles?includeArchived=null')).status).toBe(400)
  expect((await call('GET', '/api/vehicles?includeArchived=True')).status).toBe(400)
  expect((await call('GET', '/api/vehicles?includeArchived=false')).status).toBe(401)
})

it('a dispatcher and an admin can add, correct, list, and archive a Vehicle, and a driver is refused', async () => {
  const created = await tenant('hvh-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hvh-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hvh-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hvh-roles-admin@example.test')
  const dispatcher = await signIn('hvh-roles-dispatcher@example.test')
  const driver = await signIn('hvh-roles-driver@example.test')

  const refused = await call('POST', '/api/vehicles', driver, vehicleBody({ registrationPlate: 'HIDDEN1' }))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(plate)
  expect((await call('GET', '/api/vehicles', driver)).status).toBe(403)

  const added = await call('POST', '/api/vehicles', dispatcher, vehicleBody({ registrationPlate: '  du 123 ab  ' }))
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row).toEqual({
    id: expect.any(String),
    registrationPlate: plate,
    kind: 'fixed',
    registrationExpiresOn: '2027-06-01',
    technicalInspectionExpiresOn: '2028-01-31',
    insuranceExpiresOn: '2029-03-03',
    description: null,
    archivedAt: null,
  })

  const listed = await call('GET', '/api/vehicles', admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({ vehicles: [row] })

  const same = await call('PATCH', `/api/vehicles/${row.id}`, dispatcher, { registrationPlate: plate })
  expect(same.status).toBe(200)
  expect(await same.json()).toEqual(row)

  const duplicate = await call('POST', '/api/vehicles', admin, vehicleBody({ registrationPlate: 'DU 123 AB' }))
  expect(duplicate.status).toBe(409)
  const duplicateText = await duplicate.text()
  expect(duplicateText).not.toContain(plate)
  expect(duplicateText).not.toContain('DU 123 AB')
  expect(JSON.parse(duplicateText)).toMatchObject({ statusCode: 409, code: 'vehicle_plate_taken' })

  const corrected = await call('PATCH', `/api/vehicles/${row.id}`, admin, {
    registrationPlate: 'ZG111AA',
    kind: 'occasional',
    insuranceExpiresOn: '2030-04-04',
  })
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    id: row.id,
    registrationPlate: 'ZG111AA',
    kind: 'occasional',
    insuranceExpiresOn: '2030-04-04',
    archivedAt: null,
  })

  expect((await call('PATCH', `/api/vehicles/${row.id}`, driver, { kind: 'fixed' })).status).toBe(403)

  const archived = await call('POST', `/api/vehicles/${row.id}/archive`, dispatcher)
  expect(archived.status).toBe(200)
  const archivedRow = await archived.json()
  expect(archivedRow.archivedAt).toEqual(expect.any(String))

  const frozen = await call('PATCH', `/api/vehicles/${row.id}`, admin, { kind: 'fixed' })
  expect(frozen.status).toBe(409)
  const frozenText = await frozen.text()
  expect(frozenText).not.toContain('ZG111AA')
  expect(JSON.parse(frozenText)).toMatchObject({ statusCode: 409, code: 'vehicle_archived' })

  const hidden = await call('GET', '/api/vehicles', dispatcher)
  expect(await hidden.json()).toEqual({ vehicles: [] })

  const withArchived = await call('GET', '/api/vehicles?includeArchived=true', admin)
  expect(await withArchived.json()).toEqual({
    vehicles: [expect.objectContaining({
      id: row.id,
      registrationPlate: 'ZG111AA',
      kind: 'occasional',
      archivedAt: expect.any(String),
    })],
  })

  const other = await call('POST', '/api/vehicles', dispatcher, vehicleBody({ registrationPlate: 'ST333DD' }))
  expect(other.status).toBe(200)
  const otherRow = await other.json()
  const archivedPlate = await call('PATCH', `/api/vehicles/${otherRow.id}`, admin, { registrationPlate: 'ZG111AA' })
  expect(archivedPlate.status).toBe(409)
  const archivedPlateText = await archivedPlate.text()
  expect(archivedPlateText).not.toContain('ZG111AA')
  expect(JSON.parse(archivedPlateText)).toMatchObject({ statusCode: 409, code: 'vehicle_archived_plate' })

  const again = await call('POST', `/api/vehicles/${row.id}/archive`, admin)
  expect(again.status).toBe(200)
  expect((await again.json()).archivedAt).toBe(archivedRow.archivedAt)

  const reused = await call('POST', '/api/vehicles', dispatcher, vehicleBody({ registrationPlate: 'ZG111AA' }))
  expect(reused.status).toBe(200)

  const missing = 'a1b2c3d4-5555-4555-8555-555555555555'
  expect((await call('PATCH', `/api/vehicles/${missing}`, admin, { kind: 'fixed' })).status).toBe(404)
  expect((await call('POST', `/api/vehicles/${missing}/archive`, admin)).status).toBe(404)

  const rows = await auditRows(created.tenantId)
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const text = JSON.stringify(rows)
  expect(text).not.toContain(plate)
  expect(text).not.toContain('ZG111AA')
  expect(text).not.toContain('2027-06-01')
  expect(text).not.toContain('2030-04-04')
  expect(rows.map(entry => entry.action)).toContain('vehicle.created')
  expect(rows.map(entry => entry.action)).toContain('vehicle.archived')
  const fieldChanges = rows.filter(entry => entry.action === 'vehicle.field_changed').map(entry => entry.data)
  expect(fieldChanges).toHaveLength(3)
  expect(fieldChanges).toEqual(expect.arrayContaining([
    { vehicleId: row.id, field: 'registrationPlate' },
    { vehicleId: row.id, field: 'kind' },
    { vehicleId: row.id, field: 'insuranceExpiresOn' },
  ]))
})

it('another Tenant cannot read or change these Vehicles', async () => {
  await tenant('hvh-iso-a', 'Ana Admin')
  await tenant('hvh-iso-b', 'Boris Admin')
  const adminA = await signIn('hvh-iso-a-admin@example.test')
  const adminB = await signIn('hvh-iso-b-admin@example.test')

  const added = await call('POST', '/api/vehicles', adminA, vehicleBody({ registrationPlate: 'OS444BB' }))
  expect(added.status).toBe(200)
  const row = await added.json()

  expect(await (await call('GET', '/api/vehicles', adminB)).json()).toEqual({ vehicles: [] })
  expect((await call('PATCH', `/api/vehicles/${row.id}`, adminB, { kind: 'occasional' })).status).toBe(404)
  expect((await call('POST', `/api/vehicles/${row.id}/archive`, adminB)).status).toBe(404)
  expect(await (await call('GET', '/api/vehicles', adminA)).json()).toEqual({
    vehicles: [expect.objectContaining({ id: row.id, registrationPlate: 'OS444BB' })],
  })
})
