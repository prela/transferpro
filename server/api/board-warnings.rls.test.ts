import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { EXPIRING_DOCUMENT_KINDS, instantFromWallClock } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { setRosterDay } from '../modules/roster'
import { closeTenantRuntime, createTenant, handleAuthRequest, updateTenantSettings } from '../modules/tenancy'
import { acceptRide, assignRide, correctTransfer, createTransfer, listTransferDay } from '../modules/transfers'
import { archiveVehicle, createVehicle } from '../modules/vehicles'

/**
 * Day-board warnings on GET /api/transfers via listTransferDay.
 * The warnings are derived on that read. A driver is 403. Another Tenant
 * does not appear. Reading writes no audit entry.
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
const password = 'board-warnings-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const zone = 'Europe/Zagreb'
const validOn = '2031-01-01'

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.roster where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hbw-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hbw-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hbw-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hbw-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hbw-%'`)
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

function at(wall: string): string {
  return instantFromWallClock(wall, zone).toISOString()
}

async function tenant(slug: string) {
  return createTenant({
    name: `Tenant ${slug}`,
    slug,
    adminEmail: `${slug}-admin@example.test`,
    adminName: 'Hana Admin',
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

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    'select count(*) from app.audit_entry where tenant_id = $1',
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

interface Office {
  readonly dispatcher: Headers
  readonly admin: Headers
  readonly clientId: string
  readonly startId: string
  readonly endId: string
}

async function office(slug: string): Promise<Office & { tenantId: string }> {
  const created = await tenant(slug)
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const admin = await signIn(`${slug}-admin@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return {
    tenantId: created.tenantId,
    dispatcher,
    admin,
    clientId: client.id,
    startId: start.id,
    endId: end.id,
  }
}

async function driver(session: Headers, name: string, phone: string, driving: string, transport: string, memberUserId?: string) {
  return createDriver(session, {
    name,
    kind: 'own',
    phone,
    drivingLicenceExpiresOn: driving,
    transportLicenceExpiresOn: transport,
    ...(memberUserId === undefined ? {} : { memberUserId }),
  })
}

async function vehicle(
  session: Headers,
  plate: string,
  registration: string,
  inspection: string,
  insurance: string,
) {
  return createVehicle(session, {
    registrationPlate: plate,
    kind: 'fixed',
    registrationExpiresOn: registration,
    technicalInspectionExpiresOn: inspection,
    insuranceExpiresOn: insurance,
  })
}

async function ride(
  session: Headers,
  places: Office,
  guestName: string,
  pickupAt: string,
  driverId: string,
  vehicleId: string,
  confirm = false,
) {
  const recorded = await createTransfer(session, {
    clientId: places.clientId,
    pickupAt,
    startLocationId: places.startId,
    endLocationId: places.endId,
    passengerCount: 1,
    guestName,
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    tabla: '',
  })
  const assigned = await assignRide(session, {
    rideId: recorded.ride.id,
    driverId,
    vehicleId,
    ...(confirm ? { confirm: true } : {}),
  })
  return { transferId: recorded.transfer.id, rideId: assigned.ride.id }
}

async function warnings(session: Headers, day: string, guestName: string) {
  const listed = await listTransferDay(session, day)
  const row = listed.rides.find(item => item.guestName === guestName)
  if (!row)
    throw new Error(`missing ${guestName}`)
  return row.warnings
}

it('names each expired document in kind order, and a document valid on the pickup day stays quiet', async () => {
  const places = await office('hbw-docs')
  const lapsed = await driver(places.dispatcher, 'Ivo Lapsed', '+385910000201', '2026-10-19', '2026-10-18')
  const quiet = await driver(places.dispatcher, 'Tea Quiet', '+385910000202', '2026-10-20', '2026-10-20')
  const lapsedCar = await vehicle(places.dispatcher, 'DU201AA', '2026-10-17', '2026-10-16', '2026-10-15')
  const quietCar = await vehicle(places.dispatcher, 'DU202AA', '2026-10-20', '2026-10-20', '2026-10-20')
  await ride(places.dispatcher, places, 'Lapsed Ivo', at('2026-10-20T12:00'), lapsed.id, lapsedCar.id)
  await ride(places.dispatcher, places, 'Quiet Tea', at('2026-10-20T15:00'), quiet.id, quietCar.id)
  const recorded = await createTransfer(places.dispatcher, {
    clientId: places.clientId,
    pickupAt: at('2026-10-20T18:00'),
    startLocationId: places.startId,
    endLocationId: places.endId,
    passengerCount: 1,
    guestName: 'Open Una',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    tabla: '',
  })
  expect(recorded.ride.state).toBe('unassigned')

  const before = await auditCount(places.tenantId)
  expect(await warnings(places.dispatcher, '2026-10-20', 'Lapsed Ivo')).toEqual({
    expiredDocuments: [...EXPIRING_DOCUMENT_KINDS],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect(await warnings(places.admin, '2026-10-20', 'Quiet Tea')).toEqual({
    expiredDocuments: [],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect(await warnings(places.dispatcher, '2026-10-20', 'Open Una')).toEqual({
    expiredDocuments: [],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect(await auditCount(places.tenantId)).toBe(before)
})

it('judges a 02:00 pickup by its calendar date, and an accepted in-progress ride keeps the warning', async () => {
  const places = await office('hbw-date')
  const driverUserId = await addMember(places.tenantId, 'hbw-date-driver@example.test', 'Drago Driver', 'driver')
  const early = await driver(places.dispatcher, 'Ivo Early', '+385910000211', '2026-10-20', '2026-10-21', driverUserId)
  await updateDriver(places.admin, early.id, { mustAccept: true })
  const running = await driver(places.dispatcher, 'Ivo Running', '+385910000212', '2026-10-12', validOn)
  const car = await vehicle(places.dispatcher, 'DU211AA', validOn, validOn, validOn)
  const otherCar = await vehicle(places.dispatcher, 'DU212AA', validOn, validOn, validOn)
  // 02:00 on 21 October is listed on the operational day of 20 October.
  // The licence expired on 20 October, the day before that pickup's calendar date.
  const saved = await ride(places.dispatcher, places, 'Early Ivo', at('2026-10-21T02:00'), early.id, car.id)
  const driverSession = await signIn('hbw-date-driver@example.test')
  await acceptRide(driverSession, saved.rideId, {})
  await ride(places.dispatcher, places, 'Running Ivo', at('2026-10-13T12:00'), running.id, otherCar.id)

  expect(await warnings(places.dispatcher, '2026-10-20', 'Early Ivo')).toMatchObject({
    expiredDocuments: ['driving_licence'],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect(await warnings(places.dispatcher, '2026-10-13', 'Running Ivo')).toMatchObject({
    expiredDocuments: ['driving_licence'],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
})

it('follows a roster change, including a stored row for an archived vehicle, and ignores a free vehicle', async () => {
  const places = await office('hbw-roster')
  const ana = await driver(places.dispatcher, 'Ana Ana', '+385910000221', validOn, validOn)
  const branko = await driver(places.dispatcher, 'Branko Branko', '+385910000222', validOn, validOn)
  const shared = await vehicle(places.dispatcher, 'DU221AA', '2026-10-01', validOn, validOn)
  const other = await vehicle(places.dispatcher, 'DU222AA', validOn, validOn, validOn)
  const free = await vehicle(places.dispatcher, 'DU223AA', validOn, validOn, validOn)
  await ride(places.dispatcher, places, 'Roster Ana', at('2026-10-20T12:00'), ana.id, shared.id)
  await ride(places.dispatcher, places, 'Free Ana', at('2026-10-20T16:00'), ana.id, free.id)
  await setRosterDay(places.dispatcher, {
    rosterDate: '2026-10-20',
    driverId: ana.id,
    vehicleId: other.id,
  })

  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).rosterMismatch).toBe(false)
  expect((await warnings(places.dispatcher, '2026-10-20', 'Free Ana')).rosterMismatch).toBe(false)

  await setRosterDay(places.dispatcher, {
    rosterDate: '2026-10-20',
    driverId: branko.id,
    vehicleId: shared.id,
  })
  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).rosterMismatch).toBe(true)
  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).expiredDocuments).toEqual(['vehicle_registration'])

  await archiveVehicle(places.dispatcher, shared.id)
  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).rosterMismatch).toBe(true)
  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).expiredDocuments).toEqual(['vehicle_registration'])

  await setRosterDay(places.dispatcher, {
    rosterDate: '2026-10-20',
    driverId: branko.id,
    vehicleId: null,
  })
  expect((await warnings(places.dispatcher, '2026-10-20', 'Roster Ana')).rosterMismatch).toBe(false)
})

it('shows an overlap across the operational-day boundary, after a correction, and when the relocation gap changes', async () => {
  const places = await office('hbw-overlap')
  const ana = await driver(places.dispatcher, 'Ana Ana', '+385910000231', validOn, validOn)
  const lateCar = await vehicle(places.dispatcher, 'DU231AA', validOn, validOn, validOn)
  const nextCar = await vehicle(places.dispatcher, 'DU232AA', validOn, validOn, validOn)
  const early = await ride(places.dispatcher, places, 'Early Ana', at('2026-10-21T04:30'), ana.id, lateCar.id)
  const next = await ride(places.dispatcher, places, 'Next Ana', at('2026-10-21T05:10'), ana.id, nextCar.id, true)

  const earlyDay = await listTransferDay(places.dispatcher, '2026-10-20')
  expect(earlyDay.rides.map(row => row.guestName)).toEqual(['Early Ana'])
  expect(earlyDay.rides[0]?.warnings.overlappingRideIds).toEqual([next.rideId])
  const nextDay = await listTransferDay(places.dispatcher, '2026-10-21')
  expect(nextDay.rides.map(row => row.guestName)).toEqual(['Next Ana'])
  expect(nextDay.rides[0]?.warnings.overlappingRideIds).toEqual([early.rideId])

  const noon = await ride(places.dispatcher, places, 'Noon Ana', at('2026-10-22T12:00'), ana.id, lateCar.id)
  const later = await ride(places.dispatcher, places, 'Later Ana', at('2026-10-22T15:00'), ana.id, nextCar.id)
  expect((await warnings(places.dispatcher, '2026-10-22', 'Noon Ana')).overlappingRideIds).toEqual([])
  await correctTransfer(places.dispatcher, noon.transferId, {
    clientId: places.clientId,
    pickupAt: at('2026-10-22T14:30'),
    startLocationId: places.startId,
    endLocationId: places.endId,
    passengerCount: 1,
    guestName: 'Noon Ana',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    tabla: '',
    // The move is a true overlap. The board warning is what a confirmed save leaves behind.
    confirm: true,
  })
  expect(await warnings(places.dispatcher, '2026-10-22', 'Noon Ana')).toMatchObject({
    overlappingRideIds: [later.rideId],
  })
  expect(await warnings(places.dispatcher, '2026-10-22', 'Later Ana')).toMatchObject({
    overlappingRideIds: [noon.rideId],
  })

  const first = await ride(places.dispatcher, places, 'Gap Ana', at('2026-10-23T12:00'), ana.id, lateCar.id)
  const second = await ride(places.dispatcher, places, 'Gap After', at('2026-10-23T13:20'), ana.id, nextCar.id)
  expect((await warnings(places.dispatcher, '2026-10-23', 'Gap Ana')).overlappingRideIds).toEqual([])
  await updateTenantSettings(places.admin, { relocationGapMinutes: 30 })
  expect(await warnings(places.dispatcher, '2026-10-23', 'Gap Ana')).toMatchObject({
    overlappingRideIds: [second.rideId],
  })
  expect(await warnings(places.dispatcher, '2026-10-23', 'Gap After')).toMatchObject({
    overlappingRideIds: [first.rideId],
  })
  await updateTenantSettings(places.admin, { relocationGapMinutes: 20 })
  expect((await warnings(places.dispatcher, '2026-10-23', 'Gap Ana')).overlappingRideIds).toEqual([])
})

it('a landing that starts before the search window and ends after it still warns', async () => {
  const places = await office('hbw-span')
  const ana = await driver(places.dispatcher, 'Ana Ana', '+385910000261', validOn, validOn)
  const earlyCar = await vehicle(places.dispatcher, 'DU261AA', validOn, validOn, validOn)
  const dayCar = await vehicle(places.dispatcher, 'DU262AA', validOn, validOn, validOn)
  const spanned = await ride(places.dispatcher, places, 'Spanned Ana', at('2026-10-17T12:00'), ana.id, earlyCar.id)
  await ownerPool.query(
    'update app.transfers set landing_at = $2 where id = $1',
    [spanned.transferId, at('2026-10-24T12:00')],
  )
  const listed = await ride(places.dispatcher, places, 'Listed Ana', at('2026-10-20T12:00'), ana.id, dayCar.id, true)

  const day = await listTransferDay(places.dispatcher, '2026-10-20')
  expect(day.rides.map(row => row.guestName)).toEqual(['Listed Ana'])
  expect(day.rides[0]?.warnings.overlappingRideIds).toEqual([spanned.rideId])
  expect(JSON.stringify(day)).not.toContain('Spanned Ana')
  expect(listed.rideId).not.toBe(spanned.rideId)
})

it('a finished ride neither shows nor causes an overlap', async () => {
  const places = await office('hbw-done')
  const ana = await driver(places.dispatcher, 'Ana Ana', '+385910000241', validOn, validOn)
  const car = await vehicle(places.dispatcher, 'DU241AA', validOn, validOn, validOn)
  const other = await vehicle(places.dispatcher, 'DU242AA', validOn, validOn, validOn)
  const done = await ride(places.dispatcher, places, 'Done Ana', at('2026-10-20T12:00'), ana.id, car.id)
  await ride(places.dispatcher, places, 'Live Ana', at('2026-10-20T12:30'), ana.id, other.id, true)
  await ownerPool.query(`update app.rides set state = 'done' where id = $1`, [done.rideId])

  expect(await warnings(places.dispatcher, '2026-10-20', 'Done Ana')).toEqual({
    expiredDocuments: [],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect((await warnings(places.dispatcher, '2026-10-20', 'Live Ana')).overlappingRideIds).toEqual([])
})

it('refuses a driver and keeps another tenant out of the warnings', async () => {
  const places = await office('hbw-iso')
  await addMember(places.tenantId, 'hbw-iso-driver@example.test', 'Drago Driver', 'driver')
  const driverSession = await signIn('hbw-iso-driver@example.test')
  const ana = await driver(places.dispatcher, 'Ana Ana', '+385910000251', validOn, validOn)
  const car = await vehicle(places.dispatcher, 'DU251AA', validOn, validOn, validOn)
  await ride(places.dispatcher, places, 'Home Ana', at('2026-10-20T12:00'), ana.id, car.id)

  const other = await office('hbw-iso-b')
  const lapsed = await driver(other.dispatcher, 'Ivo Other', '+385910000252', '2020-01-01', '2020-01-01')
  const otherCar = await vehicle(other.dispatcher, 'ST251AA', '2020-01-01', '2020-01-01', '2020-01-01')
  const foreign = await ride(other.dispatcher, other, 'Foreign Ivo', at('2026-10-20T12:10'), lapsed.id, otherCar.id)
  await setRosterDay(other.dispatcher, {
    rosterDate: '2026-10-20',
    driverId: lapsed.id,
    vehicleId: otherCar.id,
  })

  await expect(listTransferDay(driverSession, '2026-10-20')).rejects.toMatchObject({ statusCode: 403 })
  const home = await listTransferDay(places.dispatcher, '2026-10-20')
  expect(home.rides.map(row => row.guestName)).toEqual(['Home Ana'])
  expect(home.rides[0]?.warnings).toEqual({
    expiredDocuments: [],
    rosterMismatch: false,
    overlappingRideIds: [],
  })
  expect(JSON.stringify(home)).not.toContain(foreign.rideId)
  expect(JSON.stringify(home)).not.toContain('Foreign Ivo')
})
