import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDriver } from '../modules/drivers'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { archiveVehicle, createVehicle } from '../modules/vehicles'
import getRoster from './roster.get'
import putRoster from './roster.put'

/**
 * GET and PUT /api/roster.
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
const password = 'roster-http-password'
const plate = 'DU123AB'
const otherPlate = 'ZG111AA'
const driverName = 'Ana Roster'
const phone = '+38591111222'
const day = '2026-10-05'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/roster', (event) => {
  if (event.method === 'PUT')
    return putRoster(event)
  return getRoster(event)
})
const callRoster = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.roster where tenant_id::text in (
      select id from auth.organization where slug like 'hro-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hro-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hro-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hro-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hro-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hro-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hro-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hro-%'`)
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
  return callRoster(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function driverBody(name: string) {
  return {
    name,
    kind: 'own' as const,
    phone,
    drivingLicenceExpiresOn: '2027-06-01',
    transportLicenceExpiresOn: '2028-01-31',
  }
}

function vehicleBody(registrationPlate: string) {
  return {
    registrationPlate,
    kind: 'fixed' as const,
    registrationExpiresOn: '2027-06-01',
    technicalInspectionExpiresOn: '2028-01-31',
    insuranceExpiresOn: '2029-03-03',
  }
}

async function auditRows(tenantId: string) {
  const result = await ownerPool.query<{ action: string, subject_user_id: string | null, data: unknown }>(
    `select action, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text like 'roster.%'
     order by occurred_at, action`,
    [tenantId],
  )
  return result.rows
}

it('put answers 400 for a bad body and does not echo the plate, and no session is 401', async () => {
  const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
  const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
  const body = { rosterDate: day, driverId, vehicleId }
  const unknown = await call('PUT', '/api/roster', undefined, { ...body, registrationPlate: plate, name: driverName })
  expect(unknown.status).toBe(400)
  const unknownText = await unknown.text()
  expect(unknownText).not.toContain(plate)
  expect(unknownText).not.toContain(driverName)
  expect(unknownText).not.toContain(phone)
  expect((await call('PUT', '/api/roster', undefined, { ...body, rosterDate: '2026-02-31' })).status).toBe(400)
  expect((await call('GET', '/api/roster')).status).toBe(400)
  expect((await call('GET', '/api/roster?date=2026-02-31')).status).toBe(400)
  expect((await call('GET', '/api/roster?date=')).status).toBe(400)
  expect((await call('GET', `/api/roster?date=${day}`)).status).toBe(401)
  expect((await call('PUT', '/api/roster', undefined, body)).status).toBe(401)
})

it('a dispatcher and an admin can set, change, and clear a day, and a driver is refused', async () => {
  const created = await tenant('hro-roles', 'Hana Admin')
  await addMember(created.tenantId, 'hro-roles-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'hro-roles-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('hro-roles-admin@example.test')
  const dispatcher = await signIn('hro-roles-dispatcher@example.test')
  const driver = await signIn('hro-roles-driver@example.test')

  const firstDriver = await createDriver(dispatcher, driverBody(driverName))
  const secondDriver = await createDriver(dispatcher, driverBody('Marko Roster'))
  const firstVehicle = await createVehicle(dispatcher, vehicleBody(plate))
  const secondVehicle = await createVehicle(dispatcher, vehicleBody(otherPlate))
  const archived = await createVehicle(dispatcher, vehicleBody('ST333DD'))
  await archiveVehicle(dispatcher, archived.id)

  const refused = await call('PUT', '/api/roster', driver, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(plate)
  expect((await call('GET', `/api/roster?date=${day}`, driver)).status).toBe(403)

  const missing = await call('PUT', '/api/roster', dispatcher, {
    rosterDate: day,
    driverId: 'b1b1b1b1-1111-4111-8111-111111111111',
    vehicleId: firstVehicle.id,
  })
  expect(missing.status).toBe(404)
  expect(await missing.text()).not.toContain(driverName)

  const archivedPut = await call('PUT', '/api/roster', dispatcher, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: archived.id,
  })
  const archivedText = await archivedPut.text()
  expect(archivedPut.status).toBe(409)
  expect(archivedText).toContain('roster_vehicle_archived')
  expect(archivedText).not.toContain('ST333DD')

  const added = await call('PUT', '/api/roster', dispatcher, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })
  expect(added.status).toBe(200)
  expect(await added.json()).toEqual({
    assignment: { driverId: firstDriver.id, vehicleId: firstVehicle.id },
  })

  const again = await call('PUT', '/api/roster', dispatcher, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })
  expect(again.status).toBe(200)
  expect((await auditRows(created.tenantId)).map(entry => entry.action)).toEqual(['roster.assigned'])

  const listed = await call('GET', `/api/roster?date=${day}`, admin)
  expect(listed.status).toBe(200)
  expect(await listed.json()).toEqual({
    rosterDate: day,
    assignments: [{ driverId: firstDriver.id, vehicleId: firstVehicle.id }],
  })
  const otherDay = await call('GET', '/api/roster?date=2026-10-06', admin)
  expect(await otherDay.json()).toEqual({ rosterDate: '2026-10-06', assignments: [] })

  const taken = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: secondDriver.id,
    vehicleId: firstVehicle.id,
  })
  const takenText = await taken.text()
  expect(taken.status).toBe(409)
  expect(takenText).toContain('roster_vehicle_taken')
  expect(takenText).not.toContain(plate)
  const stillOne = await call('GET', `/api/roster?date=${day}`, admin)
  expect(await stillOne.json()).toEqual({
    rosterDate: day,
    assignments: [{ driverId: firstDriver.id, vehicleId: firstVehicle.id }],
  })

  const changed = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: secondVehicle.id,
  })
  expect(changed.status).toBe(200)
  expect(await changed.json()).toEqual({
    assignment: { driverId: firstDriver.id, vehicleId: secondVehicle.id },
  })

  const cleared = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: null,
  })
  expect(cleared.status).toBe(200)
  expect(await cleared.json()).toEqual({ assignment: null })
  const empty = await call('GET', `/api/roster?date=${day}`, dispatcher)
  expect(await empty.json()).toEqual({ rosterDate: day, assignments: [] })

  const clearedAgain = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: null,
  })
  expect(clearedAgain.status).toBe(200)

  const rows = await auditRows(created.tenantId)
  expect(rows.map(entry => entry.action)).toEqual(['roster.assigned', 'roster.changed', 'roster.cleared'])
  expect(rows.every(entry => entry.subject_user_id === null)).toBe(true)
  const packed = JSON.stringify(rows)
  expect(packed).not.toContain(plate)
  expect(packed).not.toContain(otherPlate)
  expect(packed).not.toContain(driverName)
  expect(packed).not.toContain(phone)
  expect(rows[0]?.data).toEqual({
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })
  expect(rows[1]?.data).toEqual({
    rosterDate: day,
    driverId: firstDriver.id,
    fromVehicleId: firstVehicle.id,
    toVehicleId: secondVehicle.id,
  })
  expect(rows[2]?.data).toEqual({
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: secondVehicle.id,
  })
})

it('keeps an archived vehicle readable and does not give it to someone else', async () => {
  const created = await tenant('hro-archive', 'Iva Admin')
  const admin = await signIn('hro-archive-admin@example.test')
  const firstDriver = await createDriver(admin, driverBody(driverName))
  const secondDriver = await createDriver(admin, driverBody('Marko Roster'))
  const firstVehicle = await createVehicle(admin, vehicleBody(plate))
  const replacement = await createVehicle(admin, vehicleBody(otherPlate))

  expect((await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })).status).toBe(200)
  await archiveVehicle(admin, firstVehicle.id)

  const listed = await call('GET', `/api/roster?date=${day}`, admin)
  expect(await listed.json()).toEqual({
    rosterDate: day,
    assignments: [{ driverId: firstDriver.id, vehicleId: firstVehicle.id }],
  })

  const same = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: firstVehicle.id,
  })
  expect(same.status).toBe(200)
  expect((await auditRows(created.tenantId)).map(entry => entry.action)).toEqual(['roster.assigned'])

  const otherDriver = await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: secondDriver.id,
    vehicleId: firstVehicle.id,
  })
  const otherDriverText = await otherDriver.text()
  expect(otherDriver.status).toBe(409)
  expect(otherDriverText).toContain('roster_vehicle_archived')
  expect(otherDriverText).not.toContain(plate)

  expect((await call('PUT', '/api/roster', admin, {
    rosterDate: day,
    driverId: firstDriver.id,
    vehicleId: replacement.id,
  })).status).toBe(200)
  const after = await auditRows(created.tenantId)
  expect(after.map(entry => entry.action)).toEqual(['roster.assigned', 'roster.changed'])
  expect(JSON.stringify(after)).not.toContain(plate)
})

it('another tenant cannot read or change the roster', async () => {
  const first = await tenant('hro-a', 'Ana Admin')
  await tenant('hro-b', 'Borna Admin')
  const adminA = await signIn('hro-a-admin@example.test')
  const adminB = await signIn('hro-b-admin@example.test')
  const driver = await createDriver(adminA, driverBody(driverName))
  const vehicle = await createVehicle(adminA, vehicleBody(plate))
  expect((await call('PUT', '/api/roster', adminA, {
    rosterDate: day,
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const hidden = await call('GET', `/api/roster?date=${day}`, adminB)
  expect(hidden.status).toBe(200)
  expect(await hidden.json()).toEqual({ rosterDate: day, assignments: [] })

  const write = await call('PUT', '/api/roster', adminB, {
    rosterDate: day,
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  const writeText = await write.text()
  expect(write.status).toBe(404)
  expect(writeText).not.toContain(plate)
  expect(writeText).not.toContain(driverName)

  const still = await call('GET', `/api/roster?date=${day}`, adminA)
  expect(await still.json()).toEqual({
    rosterDate: day,
    assignments: [{ driverId: driver.id, vehicleId: vehicle.id }],
  })
  expect((await auditRows(first.tenantId)).map(entry => entry.action)).toEqual(['roster.assigned'])
})
