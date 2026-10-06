import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { calendarDateInTimeZone } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { setRosterDay } from '../modules/roster'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { createTransfer } from '../modules/transfers'
import { archiveVehicle, createVehicle } from '../modules/vehicles'
import postAssign from './rides/[id]/assign.post'
import getRosterVehicle from './rides/[id]/roster-vehicle.get'

/**
 * POST /api/rides/:id/assign and GET /api/rides/:id/roster-vehicle.
 * An invalid body is answered before a session exists. The role cases use
 * a real sign-in. The composite foreign key is also tried as the app role.
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
const databaseUrl = required('DATABASE_URL')
const password = 'assign-http-password'
const phone = '+385911110099'
const plate = 'ZG1001AA'
const guest = 'Ana Anić'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/rides', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  const marker = '/api/rides/'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
  const [id, action] = relative.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'assign' && event.method === 'POST')
    return postAssign(event)
  if (action === 'roster-vehicle' && event.method === 'GET')
    return getRosterVehicle(event)
  return new Response('Not Found', { status: 404 })
})
const callRides = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.roster where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hasg-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hasg-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hasg-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hasg-%'`)
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
  await appPool.end()
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
  return callRides(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function withAppTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

const driverBody = {
  name: 'Marko Vozač',
  kind: 'own' as const,
  phone,
  drivingLicenceExpiresOn: '2030-01-01',
  transportLicenceExpiresOn: '2030-06-01',
}

function vehicleBody(registrationPlate: string) {
  return {
    registrationPlate,
    kind: 'fixed' as const,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  }
}

async function rideRow(rideId: string) {
  const result = await ownerPool.query<{
    state: string
    driver_id: string | null
    vehicle_id: string | null
    must_accept: boolean | null
  }>(
    `select state, driver_id, vehicle_id, must_accept from app.rides where id = $1`,
    [rideId],
  )
  return result.rows[0]
}

async function assignmentAudits(tenantId: string) {
  const result = await ownerPool.query<{ actor_user_id: string, data: { rideId?: string, fields?: string[] } }>(
    `select actor_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.assigned'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function office(slug: string) {
  const created = await tenant(slug, 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const admin = await signIn(`${slug}-admin@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return { ...created, dispatcherId, dispatcher, admin, client, start, end }
}

function transferBody(world: Awaited<ReturnType<typeof office>>, pickupAt: string) {
  return {
    clientId: world.client.id,
    pickupAt,
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName: guest,
    price: 10,
    payment: 'cash' as const,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }
}

it('refuses a body that names only a Driver or only a Vehicle, and no session is 401', async () => {
  const world = await office('hasg-body')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 60 * 60 * 1000).toISOString()))
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody(plate))
  const before = await assignmentAudits(world.tenantId)

  const onlyDriver = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, { driverId: driver.id })
  expect(onlyDriver.status).toBe(400)
  expect(await onlyDriver.text()).not.toContain(phone)

  const onlyVehicle = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, { vehicleId: vehicle.id })
  expect(onlyVehicle.status).toBe(400)

  expect((await call('POST', '/api/rides/not-a-ride/assign', world.dispatcher, { driverId: driver.id, vehicleId: vehicle.id })).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, undefined, { driverId: driver.id, vehicleId: vehicle.id })).status).toBe(401)
  expect((await call('GET', `/api/rides/${recorded.ride.id}/roster-vehicle?driverId=${driver.id}`)).status).toBe(401)

  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await assignmentAudits(world.tenantId)).toEqual(before)
})

it('a driver cannot assign, and a dispatcher assign copies must-accept and names the actor', async () => {
  const world = await office('hasg-copy')
  await addMember(world.tenantId, 'hasg-copy-driver@example.test', 'Drago Driver', 'driver')
  const driverSession = await signIn('hasg-copy-driver@example.test')
  const driver = await createDriver(world.dispatcher, driverBody)
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG1002AA'))
  const first = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()))
  const second = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()))

  const refused = await call('POST', `/api/rides/${first.ride.id}/assign`, driverSession, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })
  expect(await assignmentAudits(world.tenantId)).toEqual([])

  const assigned = await call('POST', `/api/rides/${first.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toEqual({
    id: first.ride.id,
    transferId: first.transfer.id,
    state: 'assigned',
    driverId: driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  const audits = await assignmentAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  expect(audits[0]?.actor_user_id).toBe(world.dispatcherId)
  expect(audits[0]?.data).toEqual({
    rideId: first.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
  })
  expect(JSON.stringify(audits[0]?.data)).not.toContain(phone)
  expect(JSON.stringify(audits[0]?.data)).not.toContain(guest)

  await updateDriver(world.admin, driver.id, { mustAccept: false })
  expect(await rideRow(first.ride.id)).toMatchObject({ must_accept: true, state: 'assigned' })

  const again = await call('POST', `/api/rides/${first.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(again.status).toBe(409)
  expect(await again.text()).toContain('ride_not_unassigned')
  expect(await assignmentAudits(world.tenantId)).toHaveLength(1)

  const later = await call('POST', `/api/rides/${second.ride.id}/assign`, world.admin, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(later.status).toBe(200)
  expect(await later.json()).toMatchObject({ mustAccept: false })
})

it('refuses another Tenant\'s Driver or Vehicle, and that Tenant cannot read or change the Ride', async () => {
  const firmA = await office('hasg-cross-a')
  const firmB = await office('hasg-cross-b')
  const driverA = await createDriver(firmA.dispatcher, driverBody)
  const vehicleA = await createVehicle(firmA.dispatcher, vehicleBody('ZG2001AA'))
  const driverB = await createDriver(firmB.dispatcher, { ...driverBody, phone: '+385911110088' })
  const vehicleB = await createVehicle(firmB.dispatcher, vehicleBody('ST2001AA'))
  const rideA = await createTransfer(firmA.dispatcher, transferBody(firmA, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()))
  const rideB = await createTransfer(firmB.dispatcher, transferBody(firmB, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()))

  const foreignDriver = await call('POST', `/api/rides/${rideB.ride.id}/assign`, firmB.dispatcher, {
    driverId: driverA.id,
    vehicleId: vehicleB.id,
  })
  expect(foreignDriver.status).toBe(404)
  expect(await foreignDriver.text()).not.toContain(phone)

  const foreignVehicle = await call('POST', `/api/rides/${rideB.ride.id}/assign`, firmB.dispatcher, {
    driverId: driverB.id,
    vehicleId: vehicleA.id,
  })
  expect(foreignVehicle.status).toBe(404)
  expect(await rideRow(rideB.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })
  expect(await assignmentAudits(firmB.tenantId)).toEqual([])

  const read = await call('GET', `/api/rides/${rideA.ride.id}/roster-vehicle?driverId=${driverB.id}`, firmB.dispatcher)
  expect(read.status).toBe(404)
  const change = await call('POST', `/api/rides/${rideA.ride.id}/assign`, firmB.dispatcher, {
    driverId: driverB.id,
    vehicleId: vehicleB.id,
  })
  expect(change.status).toBe(404)
  expect(await rideRow(rideA.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null })

  const seen = await withAppTenant(firmB.tenantId, async (client) => {
    const rows = await client.query('select id from app.rides where id = $1', [rideA.ride.id])
    const updated = await client.query('update app.rides set state = \'cancelled\' where id = $1', [rideA.ride.id])
    return { rows: rows.rowCount, updated: updated.rowCount }
  })
  expect(seen).toEqual({ rows: 0, updated: 0 })

  await expect(withAppTenant(firmB.tenantId, client => client.query(
    `update app.rides
     set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = false
     where id = $1`,
    [rideB.ride.id, driverA.id, vehicleB.id],
  ))).rejects.toMatchObject({ code: '23503', constraint: 'rides_driver_fk' })
  expect(await rideRow(rideB.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })

  await expect(withAppTenant(firmB.tenantId, client => client.query(
    `update app.rides
     set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = false
     where id = $1`,
    [rideB.ride.id, driverB.id, vehicleA.id],
  ))).rejects.toMatchObject({ code: '23503', constraint: 'rides_vehicle_fk' })
  expect(await rideRow(rideB.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })

  await expect(withAppTenant(firmB.tenantId, client => client.query(
    `insert into app.roster (roster_date, driver_id, vehicle_id) values ('2026-10-06', $1, $2)`,
    [driverA.id, vehicleB.id],
  ))).rejects.toMatchObject({ code: '23503', constraint: 'roster_driver_fk' })

  await expect(withAppTenant(firmA.tenantId, client => client.query(
    `insert into app.roster (roster_date, driver_id, vehicle_id) values ('2026-10-06', $1, $2)`,
    [driverA.id, vehicleB.id],
  ))).rejects.toMatchObject({ code: '23503', constraint: 'roster_vehicle_fk' })

  const sameTenant = await withAppTenant(firmB.tenantId, async (client) => {
    return client.query(
      `update app.rides
       set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = true
       where id = $1 and state = 'unassigned'
       returning state`,
      [rideB.ride.id, driverB.id, vehicleB.id],
    )
  })
  expect(sameTenant.rows).toEqual([{ state: 'assigned' }])
})

it('refuses an archived Vehicle with no transition and no audit row, and still accepts another Vehicle', async () => {
  const world = await office('hasg-arch')
  const driver = await createDriver(world.dispatcher, driverBody)
  const archived = await createVehicle(world.dispatcher, vehicleBody('ZG3001AA'))
  const other = await createVehicle(world.dispatcher, vehicleBody('ZG3002AA'))
  await archiveVehicle(world.dispatcher, archived.id)
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()))

  const refused = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: archived.id,
  })
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_vehicle_archived')
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await assignmentAudits(world.tenantId)).toEqual([])

  const assigned = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: other.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toMatchObject({ vehicleId: other.id, state: 'assigned' })
})

it('pre-fills the roster Vehicle for the pickup local day, skips an archived one, and a roster change does not rewrite the Ride', async () => {
  const world = await office('hasg-prefill')
  const driver = await createDriver(world.dispatcher, driverBody)
  const beforeVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4001AA'))
  const afterVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4002AA'))
  const otherVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4003AA'))
  const beforePickup = '2026-10-05T21:59:00.000Z'
  const afterPickup = '2026-10-05T22:00:00.000Z'
  const beforeDay = calendarDateInTimeZone('Europe/Zagreb', new Date(beforePickup))
  const afterDay = calendarDateInTimeZone('Europe/Zagreb', new Date(afterPickup))
  expect(beforeDay).toBe('2026-10-05')
  expect(afterDay).toBe('2026-10-06')

  await setRosterDay(world.dispatcher, { rosterDate: beforeDay, driverId: driver.id, vehicleId: beforeVehicle.id })
  await setRosterDay(world.dispatcher, { rosterDate: afterDay, driverId: driver.id, vehicleId: afterVehicle.id })
  await archiveVehicle(world.dispatcher, afterVehicle.id)

  const beforeRide = await createTransfer(world.dispatcher, transferBody(world, beforePickup))
  const afterRide = await createTransfer(world.dispatcher, transferBody(world, afterPickup))

  const beforeFill = await call('GET', `/api/rides/${beforeRide.ride.id}/roster-vehicle?driverId=${driver.id}`, world.dispatcher)
  expect(beforeFill.status).toBe(200)
  expect(await beforeFill.json()).toEqual({ vehicleId: beforeVehicle.id })

  const afterFill = await call('GET', `/api/rides/${afterRide.ride.id}/roster-vehicle?driverId=${driver.id}`, world.dispatcher)
  expect(afterFill.status).toBe(200)
  expect(await afterFill.json()).toEqual({ vehicleId: null })
  expect(await rideRow(afterRide.ride.id)).toMatchObject({ state: 'unassigned', vehicle_id: null })

  const assigned = await call('POST', `/api/rides/${beforeRide.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: otherVehicle.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toMatchObject({ vehicleId: otherVehicle.id })

  await setRosterDay(world.dispatcher, { rosterDate: beforeDay, driverId: driver.id, vehicleId: beforeVehicle.id })
  const replacement = await createVehicle(world.dispatcher, vehicleBody('ZG4004AA'))
  await setRosterDay(world.dispatcher, { rosterDate: beforeDay, driverId: driver.id, vehicleId: replacement.id })
  expect(await rideRow(beforeRide.ride.id)).toMatchObject({
    state: 'assigned',
    vehicle_id: otherVehicle.id,
    driver_id: driver.id,
  })
})

it('lets exactly one of two concurrent assigns win', async () => {
  const world = await office('hasg-race')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG5001AA'))
  const other = await createVehicle(world.dispatcher, vehicleBody('ZG5002AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()))
  const body = { driverId: driver.id, vehicleId: vehicle.id }
  const otherBody = { driverId: driver.id, vehicleId: other.id }

  const [first, second] = await Promise.all([
    call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, body),
    call('POST', `/api/rides/${recorded.ride.id}/assign`, world.admin, otherBody),
  ])
  const statuses = [first.status, second.status].sort()
  expect(statuses).toEqual([200, 409])
  const winner = first.status === 200 ? await first.json() : await second.json()
  expect(winner).toMatchObject({ state: 'assigned', driverId: driver.id })
  expect([vehicle.id, other.id]).toContain(winner.vehicleId)
  const row = await rideRow(recorded.ride.id)
  expect(row).toMatchObject({ state: 'assigned', driver_id: driver.id, vehicle_id: winner.vehicleId })
  const audits = await assignmentAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  expect(audits[0]?.data.rideId).toBe(recorded.ride.id)
})
