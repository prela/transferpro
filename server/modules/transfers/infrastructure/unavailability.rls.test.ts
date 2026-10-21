import type { TenantRole } from '../../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { sql } from 'drizzle-orm'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { instantFromWallClock } from '../../../../shared'
import getDriverWindows from '../../../api/drivers/[id]/unavailability.get'
import postAcceptByPhone from '../../../api/rides/[id]/accept-by-phone.post'
import postAssign from '../../../api/rides/[id]/assign.post'
import postReassign from '../../../api/rides/[id]/reassign.post'
import postVehicle from '../../../api/rides/[id]/vehicle.post'
import getTransfers from '../../../api/transfers.get'
import patchTransfer from '../../../api/transfers/[id].patch'
import getWeek from '../../../api/unavailability.get'
import postWindow from '../../../api/unavailability.post'
import patchWindow from '../../../api/unavailability/[id].patch'
import postRemove from '../../../api/unavailability/[id]/remove.post'
import getVehicleWindows from '../../../api/vehicles/[id]/unavailability.get'
import { lockTenantCapacity } from '../../capacity'
import { createClient } from '../../clients'
import { archiveDriver, createDriver, updateDriver } from '../../drivers'
import { createLocation } from '../../locations'
import { closeTenantRuntime, createTenant, handleAuthRequest, withTenantFromSession } from '../../tenancy'
import { createVehicle } from '../../vehicles'
import { createTransfer } from './transfer-access'

/**
 * Unavailability windows through their routes (ADR-0034, issue #355): the
 * Tenant comes from the session, the office role is enforced on every
 * route, another Tenant can neither read nor write a window, the audit
 * holds ids and field names only, and a window refuses assign, a Vehicle
 * change, a reassignment, and a judged correction with 409
 * `ride_unavailable` that writes nothing until `confirm: true`. The board
 * derives the warning on read, so it follows a change and a removal.
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
const authUrl = required('BETTER_AUTH_URL')
const password = 'unavailability-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const zone = 'Europe/Zagreb'

const app = createApp()
app.use('/api/rides', (event) => {
  const [id, action] = (event.path.split('?')[0] ?? '').split('/').filter(Boolean)
  event.context.params = { id: id ?? '' }
  if (action === 'assign')
    return postAssign(event)
  if (action === 'vehicle')
    return postVehicle(event)
  if (action === 'reassign')
    return postReassign(event)
  if (action === 'accept-by-phone')
    return postAcceptByPhone(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/transfers', (event) => {
  const id = (event.path.split('?')[0] ?? '').split('/').filter(Boolean).at(-1)
  if (id === undefined)
    return getTransfers(event)
  event.context.params = { id }
  return patchTransfer(event)
})
app.use('/api/unavailability', (event) => {
  const [id, action] = (event.path.split('?')[0] ?? '').split('/').filter(Boolean)
  if (id === undefined)
    return event.method === 'GET' ? getWeek(event) : postWindow(event)
  event.context.params = { id }
  return action === 'remove' ? postRemove(event) : patchWindow(event)
})
app.use('/api/drivers', (event) => {
  event.context.params = { id: (event.path.split('?')[0] ?? '').split('/').filter(Boolean)[0] ?? '' }
  return getDriverWindows(event)
})
app.use('/api/vehicles', (event) => {
  event.context.params = { id: (event.path.split('?')[0] ?? '').split('/').filter(Boolean)[0] ?? '' }
  return getVehicleWindows(event)
})
const handle = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  const tenants = `select id from auth.organization where slug like 'huw-%'`
  try {
    await owner.query('begin')
    for (const table of ['mail_outbox', 'ride_alert', 'rides', 'roster', 'transfers', 'unavailability_windows', 'drivers', 'vehicles', 'locations', 'clients', 'tenant_settings'])
      await owner.query(`delete from app.${table} where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'huw-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'huw-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'huw-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'huw-%'`)
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

function at(wall: string): Date {
  return instantFromWallClock(wall, zone)
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

async function addMember(tenantId: string, email: string, role: TenantRole): Promise<void> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Dino Member', $2, true, now(), now())`,
    [userId, email],
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

async function office(slug: string) {
  const created = await createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName: 'Hana Admin',
    password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'dispatcher')
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'driver')
  const admin = await signIn(`${slug}-admin@example.test`)
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const driverSession = await signIn(`${slug}-driver@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  let drivers = 0
  let vehicles = 0
  return {
    tenantId: created.tenantId,
    admin,
    dispatcher,
    driverSession,
    booking(pickupAt: Date, guestName = 'Ana Anić') {
      return {
        clientId: client.id,
        pickupAt: pickupAt.toISOString(),
        startLocationId: start.id,
        endLocationId: end.id,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash' as const,
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      }
    },
    async transfer(pickupAt: Date, guestName?: string) {
      // The key is added here, not on booking(), because a correction spreads booking() and refuses the key.
      return createTransfer(dispatcher, { externalId: crypto.randomUUID(), ...this.booking(pickupAt, guestName) })
    },
    // An email, so a passing assign stages a work order in the mail outbox.
    async driver() {
      drivers += 1
      return createDriver(dispatcher, {
        name: 'Marko Vozač',
        kind: 'own',
        phone: `+38591222${String(drivers).padStart(4, '0')}`,
        email: `${slug}-driver-${drivers}@example.test`,
        drivingLicenceExpiresOn: '2030-01-01',
        transportLicenceExpiresOn: '2030-06-01',
      })
    },
    async vehicle() {
      vehicles += 1
      return createVehicle(dispatcher, {
        registrationPlate: `DU${String(vehicles).padStart(4, '0')}UW`,
        kind: 'fixed',
        registrationExpiresOn: '2030-01-01',
        technicalInspectionExpiresOn: '2030-01-01',
        insuranceExpiresOn: '2030-01-01',
      })
    },
  }
}

async function call(method: string, path: string, session: Headers, body?: unknown): Promise<Response> {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return handle(new Request(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}

async function json(response: Response): Promise<any> {
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

async function versionForRide(rideId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    `select t.version from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(result.rows[0]?.version)
}

async function assign(session: Headers, rideId: string, driverId: string, vehicleId: string, confirm = false): Promise<Response> {
  return call('POST', `/api/rides/${rideId}/assign`, session, {
    driverId,
    vehicleId,
    version: await versionForRide(rideId),
    ...(confirm ? { confirm: true } : {}),
  })
}

function windowBody(owner: { driverId?: string, vehicleId?: string }, startsAt: Date, endsAt: Date) {
  return { ...owner, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

async function snapshot(tenantId: string, ride: { id: string, transferId: string }) {
  return {
    ride: (await ownerPool.query('select state, driver_id, vehicle_id, must_accept from app.rides where id = $1', [ride.id])).rows[0],
    transfer: (await ownerPool.query('select * from app.transfers where id = $1', [ride.transferId])).rows[0],
    audit: (await ownerPool.query(
      'select id, action::text as action, data from app.audit_entry where tenant_id = $1 order by occurred_at, id',
      [tenantId],
    )).rows,
    outbox: (await ownerPool.query(
      'select id, kind, ride_id, driver_id, vehicle_id, work_order_status from app.mail_outbox where tenant_id = $1 order by created_at, id',
      [tenantId],
    )).rows,
  }
}

async function windowRows(tenantId: string) {
  return (await ownerPool.query(
    'select id, driver_id, vehicle_id, starts_at, ends_at, removed from app.unavailability_windows where tenant_id = $1 order by id',
    [tenantId],
  )).rows
}

async function auditOf(tenantId: string, prefix: string) {
  return (await ownerPool.query(
    `select action::text as action, data from app.audit_entry where tenant_id = $1 and action::text like $2 order by occurred_at, id`,
    [tenantId, `${prefix}%`],
  )).rows
}

async function boardWarnings(session: Headers, day: string, rideId: string) {
  const listed = await json(await call('GET', `/api/transfers?date=${day}`, session))
  const row = listed.rides.find((item: { rideId: string }) => item.rideId === rideId)
  if (!row)
    throw new Error(`missing ride ${rideId}`)
  return row.warnings
}

it('records, lists, moves, and removes a window, returns the Rides it covers, and audits ids and field names only', async () => {
  const world = await office('huw-life')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const covered = await world.transfer(at('2026-11-10T12:00'))
  const later = await world.transfer(at('2026-11-12T12:00'))
  expect((await assign(world.dispatcher, covered.ride.id, driver.id, vehicle.id)).status).toBe(200)
  expect((await assign(world.dispatcher, later.ride.id, driver.id, vehicle.id)).status).toBe(200)

  const startsAt = at('2026-11-10T00:00')
  const endsAt = at('2026-11-11T00:00')
  const saved = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, startsAt, endsAt)))
  expect(saved).toEqual({
    window: { id: expect.any(String), driverId: driver.id, vehicleId: null, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    coveredRides: [{ rideId: covered.ride.id, pickupAt: at('2026-11-10T12:00').toISOString() }],
  })
  const windowId = saved.window.id as string

  expect(await json(await call('GET', `/api/drivers/${driver.id}/unavailability`, world.admin))).toEqual({ windows: [saved.window] })
  expect(await json(await call('GET', `/api/vehicles/${vehicle.id}/unavailability`, world.admin))).toEqual({ windows: [] })
  expect(await json(await call('GET', '/api/unavailability?week=2026-11-09', world.dispatcher))).toEqual({ windows: [saved.window] })
  expect(await json(await call('GET', '/api/unavailability?week=2026-11-16', world.dispatcher))).toEqual({ windows: [] })

  const movedEnd = at('2026-11-13T00:00')
  const moved = await json(await call('PATCH', `/api/unavailability/${windowId}`, world.admin, { startsAt: startsAt.toISOString(), endsAt: movedEnd.toISOString() }))
  expect(moved.coveredRides.map((ride: { rideId: string }) => ride.rideId)).toEqual([covered.ride.id, later.ride.id])
  // The same instants again write and audit nothing.
  await json(await call('PATCH', `/api/unavailability/${windowId}`, world.admin, { startsAt: startsAt.toISOString(), endsAt: movedEnd.toISOString() }))

  const removed = await call('POST', `/api/unavailability/${windowId}/remove`, world.dispatcher)
  expect(removed.status).toBe(204)
  expect(await json(await call('GET', `/api/drivers/${driver.id}/unavailability`, world.admin))).toEqual({ windows: [] })
  expect((await call('POST', `/api/unavailability/${windowId}/remove`, world.dispatcher)).status).toBe(404)
  expect((await call('PATCH', `/api/unavailability/${windowId}`, world.admin, { startsAt: startsAt.toISOString(), endsAt: movedEnd.toISOString() })).status).toBe(404)
  // A removed window stays as a row until the retention job deletes it.
  expect(await windowRows(world.tenantId)).toEqual([expect.objectContaining({ id: windowId, removed: true })])

  const audit = await auditOf(world.tenantId, 'unavailability.')
  expect(audit).toEqual([
    { action: 'unavailability.added', data: { windowId, driverId: driver.id, vehicleId: null, fields: ['startsAt', 'endsAt'] } },
    { action: 'unavailability.changed', data: { windowId, driverId: driver.id, vehicleId: null, fields: ['endsAt'] } },
    { action: 'unavailability.removed', data: { windowId, driverId: driver.id, vehicleId: null, fields: ['removed'] } },
  ])
  const text = JSON.stringify(audit)
  for (const instant of [startsAt, endsAt, movedEnd])
    expect(text).not.toContain(instant.toISOString().slice(0, 16))
})

it('lists an accepted Ride the window covers, and leaves out an unassigned one', async () => {
  const world = await office('huw-accepted')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const accepted = await world.transfer(at('2026-11-14T10:00'))
  const unassigned = await world.transfer(at('2026-11-14T11:00'))
  expect((await assign(world.dispatcher, accepted.ride.id, driver.id, vehicle.id)).status).toBe(200)
  expect((await call('POST', `/api/rides/${accepted.ride.id}/accept-by-phone`, world.dispatcher, {})).status).toBe(200)
  expect((await ownerPool.query('select state from app.rides where id = $1', [accepted.ride.id])).rows).toEqual([{ state: 'accepted' }])

  const saved = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, at('2026-11-14T00:00'), at('2026-11-15T00:00'))))
  expect(saved.coveredRides).toEqual([{ rideId: accepted.ride.id, pickupAt: at('2026-11-14T10:00').toISOString() }])
  expect(saved.coveredRides).not.toContainEqual(expect.objectContaining({ rideId: unassigned.ride.id }))
})

it('refuses a bad body, a Driver role, no session, an archived Driver, and a window on two owners, writing nothing', async () => {
  const world = await office('huw-refuse')
  const driver = await world.driver()
  const vehicle = await world.vehicle()
  const startsAt = at('2026-11-10T08:00')
  const endsAt = at('2026-11-10T10:00')

  expect((await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, endsAt, startsAt))).status).toBe(400)
  expect((await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id, vehicleId: vehicle.id }, startsAt, endsAt))).status).toBe(400)
  expect((await call('POST', '/api/unavailability', world.dispatcher, { ...windowBody({ driverId: driver.id }, startsAt, endsAt), reason: 'bolovanje' })).status).toBe(400)
  expect((await call('GET', '/api/unavailability?week=2026-11-10', world.dispatcher)).status).toBe(400)
  expect((await call('POST', '/api/unavailability', world.driverSession, windowBody({ driverId: driver.id }, startsAt, endsAt))).status).toBe(403)
  expect((await call('GET', `/api/drivers/${driver.id}/unavailability`, world.driverSession)).status).toBe(403)
  expect((await call('GET', `/api/vehicles/${vehicle.id}/unavailability`, world.driverSession)).status).toBe(403)
  expect((await call('GET', '/api/unavailability?week=2026-11-09', world.driverSession)).status).toBe(403)
  expect((await call('POST', '/api/unavailability', new Headers(), windowBody({ driverId: driver.id }, startsAt, endsAt))).status).toBe(401)

  const saved = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ vehicleId: vehicle.id }, startsAt, endsAt)))
  expect((await call('PATCH', `/api/unavailability/${saved.window.id}`, world.driverSession, { startsAt: startsAt.toISOString(), endsAt: at('2026-11-10T11:00').toISOString() })).status).toBe(403)
  expect((await call('POST', `/api/unavailability/${saved.window.id}/remove`, world.driverSession)).status).toBe(403)

  await archiveDriver(world.dispatcher, driver.id)
  const archived = await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, startsAt, endsAt))
  expect(archived.status).toBe(409)
  expect(await archived.text()).toContain('unavailability_archived')
  expect(await windowRows(world.tenantId)).toHaveLength(1)
  expect(await auditOf(world.tenantId, 'unavailability.')).toHaveLength(1)
})

it('keeps another Tenant out of every window read and write', async () => {
  const home = await office('huw-iso-a')
  const other = await office('huw-iso-b')
  const driver = await home.driver()
  const vehicle = await home.vehicle()
  const startsAt = at('2026-11-10T08:00')
  const endsAt = at('2026-11-10T10:00')
  const saved = await json(await call('POST', '/api/unavailability', home.dispatcher, windowBody({ driverId: driver.id }, startsAt, endsAt)))
  const before = await windowRows(home.tenantId)

  expect((await call('GET', `/api/drivers/${driver.id}/unavailability`, other.admin)).status).toBe(404)
  expect((await call('GET', `/api/vehicles/${vehicle.id}/unavailability`, other.admin)).status).toBe(404)
  expect(await json(await call('GET', '/api/unavailability?week=2026-11-09', other.dispatcher))).toEqual({ windows: [] })
  expect((await call('POST', '/api/unavailability', other.dispatcher, windowBody({ driverId: driver.id }, startsAt, endsAt))).status).toBe(404)
  expect((await call('POST', '/api/unavailability', other.dispatcher, windowBody({ vehicleId: vehicle.id }, startsAt, endsAt))).status).toBe(404)
  expect((await call('PATCH', `/api/unavailability/${saved.window.id}`, other.admin, { startsAt: startsAt.toISOString(), endsAt: at('2026-11-10T12:00').toISOString() })).status).toBe(404)
  expect((await call('POST', `/api/unavailability/${saved.window.id}/remove`, other.admin)).status).toBe(404)

  // Below the routes: the row policy hides the row, and the composite key refuses another Tenant's Driver.
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [other.tenantId])
    expect((await client.query('select id from app.unavailability_windows where id = $1', [saved.window.id])).rows).toEqual([])
    expect((await client.query('update app.unavailability_windows set removed = true where id = $1', [saved.window.id])).rowCount).toBe(0)
    await expect(client.query(
      'insert into app.unavailability_windows (driver_id, starts_at, ends_at) values ($1, $2, $3)',
      [driver.id, startsAt, endsAt],
    )).rejects.toThrow()
    await client.query('rollback')
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [other.tenantId])
    await expect(client.query(
      'insert into app.unavailability_windows (tenant_id, driver_id, starts_at, ends_at) values ($1, $2, $3, $4)',
      [home.tenantId, driver.id, startsAt, endsAt],
    )).rejects.toThrow()
    await client.query('rollback')
  }
  finally {
    client.release()
  }

  expect(await windowRows(home.tenantId)).toEqual(before)
  expect(await windowRows(other.tenantId)).toEqual([])
  expect(await auditOf(other.tenantId, 'unavailability.')).toEqual([])
})

it('a window refuses each judged command with ride_unavailable, writing nothing, and confirm passes', async () => {
  const world = await office('huw-commands')
  const away = await world.driver()
  const awayCar = await world.vehicle()
  const free = await world.driver()
  const freeCar = await world.vehicle()
  const spare = await world.driver()
  const spareCar = await world.vehicle()
  const pickup = at('2026-11-20T12:00')
  await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: away.id }, at('2026-11-20T00:00'), at('2026-11-21T00:00'))))
  await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ vehicleId: awayCar.id }, at('2026-11-20T00:00'), at('2026-11-21T00:00'))))

  // Assign.
  const assigned = await world.transfer(pickup)
  const beforeAssign = await snapshot(world.tenantId, assigned.ride)
  const refusedAssign = await assign(world.dispatcher, assigned.ride.id, away.id, freeCar.id)
  expect(refusedAssign.status).toBe(409)
  expect(await refusedAssign.json()).toMatchObject({ statusCode: 409, data: { code: 'ride_unavailable' } })
  expect(await snapshot(world.tenantId, assigned.ride)).toEqual(beforeAssign)
  expect((await assign(world.dispatcher, assigned.ride.id, away.id, freeCar.id, true)).status).toBe(200)

  // A Vehicle change.
  const changed = await world.transfer(pickup)
  expect((await assign(world.dispatcher, changed.ride.id, free.id, spareCar.id)).status).toBe(200)
  const beforeChange = await snapshot(world.tenantId, changed.ride)
  const refusedChange = await call('POST', `/api/rides/${changed.ride.id}/vehicle`, world.dispatcher, {
    vehicleId: awayCar.id,
    version: Number(beforeChange.transfer.version),
  })
  expect(refusedChange.status).toBe(409)
  expect(await refusedChange.text()).toContain('ride_unavailable')
  expect(await snapshot(world.tenantId, changed.ride)).toEqual(beforeChange)
  expect((await call('POST', `/api/rides/${changed.ride.id}/vehicle`, world.dispatcher, {
    vehicleId: awayCar.id,
    version: Number(beforeChange.transfer.version),
    confirm: true,
  })).status).toBe(200)

  // A reassignment.
  const reassigned = await world.transfer(at('2026-11-20T18:00'))
  expect((await assign(world.dispatcher, reassigned.ride.id, spare.id, freeCar.id, true)).status).toBe(200)
  const beforeReassign = await snapshot(world.tenantId, reassigned.ride)
  const refusedReassign = await call('POST', `/api/rides/${reassigned.ride.id}/reassign`, world.dispatcher, {
    driverId: away.id,
    vehicleId: spareCar.id,
    version: Number(beforeReassign.transfer.version),
  })
  expect(refusedReassign.status).toBe(409)
  expect(await refusedReassign.text()).toContain('ride_unavailable')
  expect(await snapshot(world.tenantId, reassigned.ride)).toEqual(beforeReassign)
  expect((await call('POST', `/api/rides/${reassigned.ride.id}/reassign`, world.dispatcher, {
    driverId: away.id,
    vehicleId: spareCar.id,
    version: Number(beforeReassign.transfer.version),
    confirm: true,
  })).status).toBe(200)

  // A judged correction moves an assigned Ride into the window.
  const corrected = await world.transfer(at('2026-11-22T12:00'))
  expect((await assign(world.dispatcher, corrected.ride.id, away.id, spareCar.id)).status).toBe(200)
  const beforeCorrect = await snapshot(world.tenantId, corrected.ride)
  const refusedCorrect = await call('PATCH', `/api/transfers/${corrected.transfer.id}`, world.dispatcher, {
    ...world.booking(at('2026-11-20T09:00')),
    version: Number(beforeCorrect.transfer.version),
  })
  expect(refusedCorrect.status).toBe(409)
  expect(await refusedCorrect.text()).toContain('ride_unavailable')
  expect(await snapshot(world.tenantId, corrected.ride)).toEqual(beforeCorrect)
  expect((await call('PATCH', `/api/transfers/${corrected.transfer.id}`, world.dispatcher, {
    ...world.booking(at('2026-11-20T09:00')),
    version: Number(beforeCorrect.transfer.version),
    confirm: true,
  })).status).toBe(200)
})

it('one confirmation passes an overlap and an unavailability together, and the refusal names the window', async () => {
  const world = await office('huw-both')
  const away = await world.driver()
  const car = await world.vehicle()
  const otherCar = await world.vehicle()
  const pickup = at('2026-11-24T12:00')
  const taken = await world.transfer(pickup)
  expect((await assign(world.dispatcher, taken.ride.id, away.id, car.id)).status).toBe(200)
  await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: away.id }, at('2026-11-24T11:00'), at('2026-11-24T14:00'))))

  const clash = await world.transfer(new Date(pickup.getTime() + 30 * 60 * 1000))
  const before = await snapshot(world.tenantId, clash.ride)
  const refused = await assign(world.dispatcher, clash.ride.id, away.id, otherCar.id)
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_unavailable')
  expect(await snapshot(world.tenantId, clash.ride)).toEqual(before)
  expect((await assign(world.dispatcher, clash.ride.id, away.id, otherCar.id, true)).status).toBe(200)
})

it('the board shows the unavailability warning while a window covers the Ride, and drops it on a change or a removal', async () => {
  const world = await office('huw-board')
  const driver = await world.driver()
  const car = await world.vehicle()
  const pickup = at('2026-11-26T12:00')
  const ride = await world.transfer(pickup)
  expect((await assign(world.dispatcher, ride.ride.id, driver.id, car.id)).status).toBe(200)
  const quiet = { expiredDocuments: [], rosterMismatch: false, overlappingRideIds: [] }
  expect(await boardWarnings(world.dispatcher, '2026-11-26', ride.ride.id)).toEqual(quiet)

  const saved = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ vehicleId: car.id }, at('2026-11-26T12:30'), at('2026-11-26T15:00'))))
  expect(saved.coveredRides).toEqual([{ rideId: ride.ride.id, pickupAt: pickup.toISOString() }])
  expect(await boardWarnings(world.dispatcher, '2026-11-26', ride.ride.id)).toEqual({ ...quiet, unavailable: ['vehicle'] })

  // Moved to start where the occupied window ends: half-open, so the Ride is free.
  await json(await call('PATCH', `/api/unavailability/${saved.window.id}`, world.dispatcher, {
    startsAt: at('2026-11-26T13:00').toISOString(),
    endsAt: at('2026-11-26T15:00').toISOString(),
  }))
  expect(await boardWarnings(world.dispatcher, '2026-11-26', ride.ride.id)).toEqual(quiet)

  const driverWindow = await json(await call('POST', '/api/unavailability', world.admin, windowBody({ driverId: driver.id }, at('2026-11-26T00:00'), at('2026-11-27T00:00'))))
  expect(await boardWarnings(world.admin, '2026-11-26', ride.ride.id)).toEqual({ ...quiet, unavailable: ['driver'] })
  expect((await call('POST', `/api/unavailability/${driverWindow.window.id}/remove`, world.admin)).status).toBe(204)
  expect(await boardWarnings(world.admin, '2026-11-26', ride.ride.id)).toEqual(quiet)
})

const backendRows = z.object({ rows: z.array(z.object({ pid: z.number().int() })) })

it('a window write waits on a held capacity write of the same Tenant', async () => {
  const world = await office('huw-lock')
  const driver = await world.driver()
  const startsAt = at('2026-11-28T08:00')
  const endsAt = at('2026-11-28T10:00')
  const saved = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, startsAt, endsAt)))
  const writes: Array<[string, () => Promise<Response>]> = [
    ['add', () => call('POST', '/api/unavailability', world.dispatcher, windowBody({ driverId: driver.id }, endsAt, at('2026-11-28T12:00')))],
    ['change', () => call('PATCH', `/api/unavailability/${saved.window.id}`, world.dispatcher, { startsAt: startsAt.toISOString(), endsAt: at('2026-11-28T09:00').toISOString() })],
    ['remove', () => call('POST', `/api/unavailability/${saved.window.id}/remove`, world.dispatcher)],
  ]
  for (const [name, send] of writes) {
    let sent: Promise<Response> | undefined
    const order = await withTenantFromSession(world.admin, async ({ transaction }) => {
      await lockTenantCapacity(transaction)
      const pid = backendRows.parse(await transaction.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid ?? 0
      sent = send()
      return answeredOrWaited(pid, sent)
    })
    expect({ name, order }).toEqual({ name, order: 'waited' })
    expect((await sent!).status).toBeLessThan(300)
  }
})

/** `answered` when the route finished first; `waited` when another backend is blocked by `holder` first. */
async function answeredOrWaited(holder: number, sent: Promise<Response>): Promise<'answered' | 'waited'> {
  const route = { answered: false }
  void sent.then(() => {
    route.answered = true
  }, () => {
    route.answered = true
  })
  const watcher = await appPool.connect()
  try {
    while (!route.answered) {
      const blocked = await watcher.query('select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [holder])
      if ((blocked.rowCount ?? 0) > 0 && !route.answered)
        return 'waited'
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return 'answered'
  }
  finally {
    watcher.release()
  }
}

it('reads the week in the Tenant time zone and keeps the hour of the half-open edges', async () => {
  const world = await office('huw-week')
  const vehicle = await world.vehicle()
  // Ends exactly at local midnight that starts the week: it does not touch it.
  await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ vehicleId: vehicle.id }, at('2026-11-08T20:00'), at('2026-11-09T00:00'))))
  const inside = await json(await call('POST', '/api/unavailability', world.dispatcher, windowBody({ vehicleId: vehicle.id }, at('2026-11-15T23:00'), at('2026-11-16T02:00'))))
  expect(await json(await call('GET', '/api/unavailability?week=2026-11-09', world.dispatcher))).toEqual({ windows: [inside.window] })
})
