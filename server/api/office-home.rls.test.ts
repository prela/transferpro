import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, officeHomeSchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { assignRide, createTransfer, readOfficeHome } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import getOfficeHome from './office-home.get'

/**
 * GET /api/office-home. The role cases use a real sign-in. The snapshot
 * clock is noon on the Tenant's calendar date, so the operational day does
 * not depend on the minute the test starts. Pickups stay inside the window.
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
const password = 'office-home-http-password'
const zone = 'Europe/Zagreb'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/office-home', getOfficeHome)
const callHome = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'ohm-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'ohm-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'ohm-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'ohm-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'ohm-%'`)
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

function call(session?: Headers) {
  return callHome(new Request('http://localhost/api/office-home', {
    method: 'GET',
    headers: session,
  }))
}

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function setRideState(rideId: string, state: 'done' | 'no-show' | 'cancelled') {
  await ownerPool.query(`update app.rides set state = $2 where id = $1`, [rideId, state])
}

it('no session is 401 and a driver is 403, and the refusal does not name a guest', async () => {
  const created = await tenant('ohm-driver', 'Hana Admin')
  await addMember(created.tenantId, 'ohm-driver-driver@example.test', 'Drago Driver', 'driver')
  const driver = await signIn('ohm-driver-driver@example.test')
  const guest = 'Tajna Gošća'

  const unsigned = await call()
  expect(unsigned.status).toBe(401)
  expect(await unsigned.text()).not.toContain(guest)

  const refused = await call(driver)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(guest)
  await expect(readOfficeHome(driver)).rejects.toMatchObject({ statusCode: 403 })
})

it('returns one snapshot for an admin and a dispatcher, hides another Tenant, and writes no audit entry', async () => {
  const created = await tenant('ohm-snap', 'Hana Admin')
  await addMember(created.tenantId, 'ohm-snap-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'ohm-snap-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('ohm-snap-admin@example.test')
  const dispatcher = await signIn('ohm-snap-dispatcher@example.test')
  await tenant('ohm-other', 'Iva Admin')
  const outsider = await signIn('ohm-other-admin@example.test')

  const calendar = calendarDateInTimeZone(zone, new Date())
  const previous = addCalendarDays(calendar, -1)
  const next = addCalendarDays(calendar, 1)
  const now = instantFromWallClock(`${calendar}T12:00`, zone)
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Excelsior', kind: 'hotel' })
  const mustDriver = await createDriver(admin, {
    name: 'Marko Vozač',
    kind: 'own',
    phone: '+385911110201',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  await updateDriver(admin, mustDriver.id, { mustAccept: true })
  const plainDriver = await createDriver(admin, {
    name: 'Ana Slobodna',
    kind: 'own',
    phone: '+385911110202',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(admin, {
    registrationPlate: 'DU200AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })

  async function record(
    guestName: string,
    wall: string,
    payment: 'cash' | 'card' | 'invoice_to_agency',
    price: number,
    flightNumber?: string,
  ) {
    const recorded = await createTransfer(admin, {
      clientId: client.id,
      pickupAt: instantFromWallClock(wall, zone).toISOString(),
      startLocationId: start.id,
      endLocationId: end.id,
      passengerCount: 2,
      guestName,
      flightNumber,
      price,
      payment,
      airportMark: false,
      luggageCount: 1,
      childSeatCount: 0,
    })
    return recorded.ride.id
  }

  await record('Alarm Ana', `${calendar}T14:00`, 'cash', 42.5, 'OU 384')
  await record('Agency Bill', `${calendar}T15:00`, 'invoice_to_agency', 0)
  await record('Far Ivo', `${calendar}T18:00`, 'card', 18)
  await record('Tomorrow Eva', `${next}T12:00`, 'cash', 10)
  await record('Yesterday Luka', `${previous}T12:00`, 'cash', 10)

  const waitingToday = await record('Waiting Nika', `${calendar}T13:00`, 'cash', 10)
  await assignRide(admin, { rideId: waitingToday, driverId: mustDriver.id, vehicleId: vehicle.id })
  const waitingTomorrow = await record('Waiting Tomorrow', `${next}T15:00`, 'cash', 10)
  await assignRide(admin, { rideId: waitingTomorrow, driverId: mustDriver.id, vehicleId: vehicle.id })

  const progressYesterday = await record('Progress Lara', `${previous}T11:00`, 'cash', 10)
  await assignRide(admin, { rideId: progressYesterday, driverId: plainDriver.id, vehicleId: vehicle.id })
  const progressToday = await record('Progress Today', `${calendar}T10:00`, 'cash', 10)
  await assignRide(admin, { rideId: progressToday, driverId: plainDriver.id, vehicleId: vehicle.id })

  const aheadId = await record('Ahead Only', `${calendar}T20:00`, 'cash', 10)
  await assignRide(admin, { rideId: aheadId, driverId: plainDriver.id, vehicleId: vehicle.id })

  await setRideState(await record('Done Mia', `${calendar}T11:00`, 'cash', 10), 'done')
  await setRideState(await record('No-show Mia', `${calendar}T09:00`, 'cash', 10), 'no-show')
  await setRideState(await record('Cancelled Tea', `${calendar}T08:00`, 'cash', 10), 'cancelled')

  const audits = await auditCount(created.tenantId)
  const snapshot = officeHomeSchema.parse(await readOfficeHome(admin, now))
  expect(officeHomeSchema.parse(await readOfficeHome(dispatcher, now))).toEqual(snapshot)
  expect(await auditCount(created.tenantId)).toBe(audits)

  expect(snapshot.unassigned.map(row => row.guestName)).toEqual([
    'Yesterday Luka',
    'Alarm Ana',
    'Agency Bill',
    'Far Ivo',
    'Tomorrow Eva',
  ])
  expect(Object.fromEntries(snapshot.unassigned.map(row => [row.guestName, row.unassignedAlarm]))).toEqual({
    'Yesterday Luka': false,
    'Alarm Ana': true,
    'Agency Bill': true,
    'Far Ivo': false,
    'Tomorrow Eva': false,
  })
  expect(snapshot.unassigned.find(row => row.guestName === 'Alarm Ana')).toMatchObject({
    price: '42.50',
    payment: 'cash',
    flightNumber: 'OU 384',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    driverName: null,
    vehiclePlate: null,
  })
  expect(snapshot.unassigned.find(row => row.guestName === 'Far Ivo')).toMatchObject({
    price: '18.00',
    payment: 'card',
    flightNumber: null,
  })
  expect(snapshot.unassigned.find(row => row.guestName === 'Agency Bill')).toMatchObject({
    price: '0.00',
    payment: 'invoice_to_agency',
    flightNumber: null,
  })

  expect(snapshot.waitingOnAcceptance.map(row => row.guestName)).toEqual(['Waiting Nika', 'Waiting Tomorrow'])
  expect(snapshot.waitingOnAcceptance.every(row => !('unassignedAlarm' in row))).toBe(true)
  expect(snapshot.waitingOnAcceptance[0]).toMatchObject({
    driverName: 'Marko Vozač',
    vehiclePlate: 'DU200AA',
    state: 'assigned',
  })

  expect(snapshot.inProgress.map(row => row.guestName)).toEqual(['Progress Lara', 'Progress Today'])
  expect(snapshot.inProgress[0]).toMatchObject({
    driverName: 'Ana Slobodna',
    vehiclePlate: 'DU200AA',
  })

  expect(snapshot.counts).toEqual({
    rides: 9,
    unassigned: 3,
    waitingOnAcceptance: 1,
    inProgress: 1,
    done: 1,
    noShow: 1,
    cancelled: 1,
  })
  const listed = [
    ...snapshot.unassigned,
    ...snapshot.waitingOnAcceptance,
    ...snapshot.inProgress,
  ].map(row => row.rideId)
  expect(new Set(listed).size).toBe(listed.length)
  expect(listed).not.toContain(aheadId)

  expect(await readOfficeHome(outsider, now)).toEqual({
    unassigned: [],
    waitingOnAcceptance: [],
    inProgress: [],
    counts: {
      rides: 0,
      unassigned: 0,
      waitingOnAcceptance: 0,
      inProgress: 0,
      done: 0,
      noShow: 0,
      cancelled: 0,
    },
  })

  const http = await call(admin)
  expect(http.status).toBe(200)
  officeHomeSchema.parse(await http.json())
})

it('counts the stored hour, and a pickup before that hour stays on the unassigned list', async () => {
  const created = await tenant('ohm-hour', 'Hana Admin')
  const admin = await signIn('ohm-hour-admin@example.test')
  await ownerPool.query(
    'update app.tenant_settings set operational_day_start_hour = 6 where tenant_id = $1',
    [created.tenantId],
  )
  const calendar = '2026-10-08'
  const now = instantFromWallClock(`${calendar}T12:00`, zone)
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Excelsior', kind: 'hotel' })

  async function record(guestName: string, wall: string) {
    const recorded = await createTransfer(admin, {
      clientId: client.id,
      pickupAt: instantFromWallClock(wall, zone).toISOString(),
      startLocationId: start.id,
      endLocationId: end.id,
      passengerCount: 1,
      guestName,
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    })
    return recorded.ride.id
  }

  await record('Before six', `${calendar}T05:30`)
  await setRideState(await record('At six', `${calendar}T06:00`), 'done')
  await setRideState(await record('Next morning', '2026-10-09T05:30'), 'done')

  const snapshot = officeHomeSchema.parse(await readOfficeHome(admin, now))
  expect(snapshot.unassigned.map(row => row.guestName)).toEqual(['Before six'])
  expect(snapshot.counts).toMatchObject({
    rides: 2,
    unassigned: 0,
    done: 2,
  })
})
