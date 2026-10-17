import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../../shared'
import { captureLogs } from '../core/testing'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { archiveLocation, createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest, updateUserLocale } from '../modules/tenancy'
import { acceptRide, assignRide, correctTransfer, declineRide, listTransferDay, listUpcomingRides, readOfficeHome } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import getTransfers from './transfers.get'
import postTransfer from './transfers.post'
import patchTransfer from './transfers/[id].patch'

/**
 * GET, POST, and PATCH /api/transfers.
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
const databaseUrl = required('DATABASE_URL')
const password = 'transfers-http-password'
const guest = 'Ana Anić'
const flight = 'OU 384'
const note = 'Čeka na terminalu'
const tabla = 'GOSPOĐA HORVAT'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  // The mount strips `/api/transfers`, so a correction is `/<id>`.
  if (event.method === 'PATCH') {
    event.context.params = { id: pathOnly.split('/').filter(Boolean).at(-1) ?? '' }
    return patchTransfer(event)
  }
  if (event.method === 'POST')
    return postTransfer(event)
  return getTransfers(event)
})
const callTransfers = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.roster where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'htr-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'htr-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'htr-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'htr-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'htr-%'`)
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
  return callTransfers(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function tenantCounts(tenantId: string) {
  const result = await ownerPool.query<{ transfers: string, rides: string, audit: string }>(
    `select
       (select count(*) from app.transfers where tenant_id = $1) as transfers,
       (select count(*) from app.rides where tenant_id = $1) as rides,
       (select count(*) from app.audit_entry where tenant_id = $1) as audit`,
    [tenantId],
  )
  const row = result.rows[0]
  return {
    transfers: Number(row?.transfers),
    rides: Number(row?.rides),
    audit: Number(row?.audit),
  }
}

/** Inside the pickup window, so a later calendar does not turn a 403 or 404 into a 400. */
function pickupInsideWindow(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString()
}

/**
 * Noon on the operational day the undated board opens on.
 * An hour from now, in the hour before 05:00 Zagreb, is already the next
 * operational day. The board and office home then omit the Ride, so a
 * Tenant check on the open day would not see a row that was written.
 */
function pickupOnOpenBoard(): string {
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  return instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
}

/**
 * 00:30 local, two days ahead. That instant belongs only to the previous
 * operational day, in summer time and in winter time. The calendar date of
 * the instant stays empty.
 */
function upcomingZagrebHalfPast() {
  const calendar = calendarDateInTimeZone('Europe/Zagreb', new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))
  return {
    calendar,
    operational: addCalendarDays(calendar, -1),
    pickupAt: instantFromWallClock(`${calendar}T00:30`, 'Europe/Zagreb').toISOString(),
  }
}

function zagrebInstant(wall: string): string {
  return instantFromWallClock(wall, 'Europe/Zagreb').toISOString()
}

async function seedRide(
  tenantId: string,
  clientId: string,
  startId: string,
  endId: string,
  pickupAt: string,
  guestName: string,
) {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.transfers (
      tenant_id, client_id, pickup_at, start_location_id, end_location_id,
      passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count
    ) values ($1, $2, $3, $4, $5, 1, $6, 10.00, 'cash', false, 0, 0)
    returning id`,
    [tenantId, clientId, pickupAt, startId, endId, guestName],
  )
  await ownerPool.query(
    `insert into app.rides (tenant_id, transfer_id, state) values ($1, $2, 'unassigned')`,
    [tenantId, inserted.rows[0]?.id],
  )
}

async function listedGuests(session: Headers, day: string): Promise<string[]> {
  const response = await call('GET', `/api/transfers?date=${day}`, session)
  expect(response.status).toBe(200)
  const body = await response.json() as { rides: Array<{ guestName: string }> }
  return body.rides.map(ride => ride.guestName)
}

async function rideCount(tenantId: string, transferId?: string) {
  const result = await ownerPool.query<{ count: string }>(
    transferId
      ? `select count(*) from app.rides where tenant_id = $1 and transfer_id = $2`
      : `select count(*) from app.rides where tenant_id = $1`,
    transferId ? [tenantId, transferId] : [tenantId],
  )
  return Number(result.rows[0]?.count)
}

it('post answers 400 for a bad body and does not echo the guest name, and no session is 401', async () => {
  const refused = await call('POST', '/api/transfers', undefined, {
    clientId: '9e4b3f6d-5555-4555-8555-555555555555',
    pickupAt: pickupInsideWindow(),
    startLocationId: 'a1b2c3d4-5555-4555-8555-555555555555',
    endLocationId: 'b1b2c3d4-6666-4666-8666-666666666666',
    passengerCount: 0,
    guestName: guest,
    price: 42.5,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  expect(refused.status).toBe(400)
  expect(await refused.text()).not.toContain(guest)
  expect((await call('GET', '/api/transfers')).status).toBe(401)
  expect((await call('GET', '/api/transfers?date=2026-02-31')).status).toBe(400)
  expect((await call('GET', '/api/transfers?date=')).status).toBe(400)
})

it('a driver cannot record or list a Transfer, and nothing is created', async () => {
  const created = await tenant('htr-driver', 'Hana Admin')
  await addMember(created.tenantId, 'htr-driver-driver@example.test', 'Drago Driver', 'driver')
  const driver = await signIn('htr-driver-driver@example.test')
  const body = {
    clientId: '9e4b3f6d-5555-4555-8555-555555555555',
    pickupAt: pickupInsideWindow(),
    startLocationId: 'a1b2c3d4-5555-4555-8555-555555555555',
    endLocationId: 'b1b2c3d4-6666-4666-8666-666666666666',
    passengerCount: 1,
    guestName: guest,
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }
  const refused = await call('POST', '/api/transfers', driver, body)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(guest)
  expect((await call('GET', '/api/transfers', driver)).status).toBe(403)
  expect(await rideCount(created.tenantId)).toBe(0)
  const transfers = await ownerPool.query(`select count(*) from app.transfers where tenant_id = $1`, [created.tenantId])
  expect(Number(transfers.rows[0]?.count)).toBe(0)
})

it('records one unassigned Ride, keeps a flight from implying an airport, and lists that Ride on the Zagreb day', async () => {
  const created = await tenant('htr-day', 'Hana Admin')
  await addMember(created.tenantId, 'htr-day-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-day-dispatcher@example.test')
  const admin = await signIn('htr-day-admin@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const archived = await createLocation(dispatcher, { name: 'Stari terminal', kind: 'other' })
  await archiveLocation(dispatcher, archived.id)

  const blocked = await call('POST', '/api/transfers', dispatcher, {
    clientId: client.id,
    pickupAt: pickupInsideWindow(),
    startLocationId: archived.id,
    endLocationId: end.id,
    passengerCount: 1,
    guestName: guest,
    flightNumber: flight,
    price: 10,
    payment: 'cash',
    airportMark: true,
    luggageCount: 0,
    childSeatCount: 0,
    note,
  })
  expect(blocked.status).toBe(409)
  expect(await blocked.text()).not.toContain(guest)
  expect(await rideCount(created.tenantId)).toBe(0)

  // 00:30 in Zagreb is still the previous UTC date, and it belongs to the previous operational day.
  const sample = upcomingZagrebHalfPast()
  const added = await call('POST', '/api/transfers', dispatcher, {
    clientId: client.id,
    pickupAt: sample.pickupAt,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 2,
    guestName: `  ${guest}  `,
    flightNumber: `  ${flight}  `,
    price: 42.5,
    payment: 'invoice_to_agency',
    airportMark: false,
    luggageCount: 1,
    childSeatCount: 0,
    note: `  ${note}  `,
    tabla: `  ${tabla}  `,
  })
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.transfer).toMatchObject({
    clientId: client.id,
    pickupAt: sample.pickupAt,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 2,
    guestName: guest,
    flightNumber: flight,
    price: '42.50',
    payment: 'invoice_to_agency',
    airportMark: false,
    luggageCount: 1,
    childSeatCount: 0,
    note,
    tabla,
  })
  expect(row.ride).toEqual({
    id: expect.any(String),
    transferId: row.transfer.id,
    state: 'unassigned',
    driverId: null,
    vehicleId: null,
    mustAccept: null,
  })
  expect(await rideCount(created.tenantId, row.transfer.id)).toBe(1)

  const calendarDay = await call('GET', `/api/transfers?date=${sample.calendar}`, admin)
  expect(calendarDay.status).toBe(200)
  expect(await calendarDay.json()).toEqual({ date: sample.calendar, rides: [], declineAlerts: [] })

  const operationalDay = await call('GET', `/api/transfers?date=${sample.operational}`, dispatcher)
  expect(operationalDay.status).toBe(200)
  const listed = await operationalDay.json()
  expect(listed.date).toBe(sample.operational)
  expect(listed.rides).toEqual([
    expect.objectContaining({
      rideId: row.ride.id,
      transferId: row.transfer.id,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
      guestName: guest,
      airportMark: false,
      price: '42.50',
      tabla,
    }),
  ])

  const today = await call('GET', '/api/transfers', admin)
  expect(today.status).toBe(200)
  expect((await today.json()).date).toBe(operationalDateInTimeZone('Europe/Zagreb', new Date()))

  const audit = await ownerPool.query<{ data: unknown }>(
    `select data from app.audit_entry where tenant_id = $1 and action::text = 'transfer.created'`,
    [created.tenantId],
  )
  expect(audit.rows).toHaveLength(1)
  const auditText = JSON.stringify(audit.rows[0]?.data)
  expect(auditText).not.toContain(guest)
  expect(auditText).not.toContain(flight)
  expect(auditText).not.toContain(note)
  expect(auditText).not.toContain(tabla)
  expect(auditText).not.toContain('42.50')
  expect(audit.rows[0]?.data).toMatchObject({
    transferId: row.transfer.id,
    rideId: row.ride.id,
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
  })
})

it('a Client reference survives save and correction, and another Tenant cannot read it', async () => {
  const firmA = await tenant('htr-ref-a', 'Ana Admin')
  await tenant('htr-ref-b', 'Boris Admin')
  await addMember(firmA.tenantId, 'htr-ref-a-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const officeA = await signIn('htr-ref-a-dispatcher@example.test')
  const officeB = await signIn('htr-ref-b-admin@example.test')
  const client = await createClient(officeA, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(officeA, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(officeA, { name: 'Hotel Park', kind: 'hotel' })
  const pickupAt = pickupOnOpenBoard()
  const added = await call('POST', '/api/transfers', officeA, {
    clientId: client.id,
    pickupAt,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 1,
    guestName: 'Ana Referenca',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    clientReference: '  V-19  ',
  })
  expect(added.status).toBe(200)
  const created = await added.json() as { transfer: { id: string, clientReference: string | null }, ride: { id: string } }
  expect(created.transfer.clientReference).toBe('V-19')

  const listed = await call('GET', '/api/transfers', officeA)
  expect(listed.status).toBe(200)
  const day = await listed.json() as { rides: Array<{ transferId: string, clientReference: string | null }> }
  expect(day.rides.find(ride => ride.transferId === created.transfer.id)?.clientReference).toBe('V-19')

  const hidden = await call('GET', '/api/transfers', officeB)
  expect(hidden.status).toBe(200)
  expect(JSON.stringify(await hidden.json())).not.toContain('V-19')

  const corrected = await call('PATCH', `/api/transfers/${created.transfer.id}`, officeA, correctionBody(client.id, start.id, end.id, pickupAt, {
    guestName: 'Ana Referenca',
    flightNumber: null,
    price: 10,
    airportMark: false,
    note: null,
    tabla: '',
    clientReference: '  V-20  ',
  }))
  expect(corrected.status).toBe(200)
  expect((await corrected.json() as { transfer: { clientReference: string | null } }).transfer.clientReference).toBe('V-20')

  const reloaded = await call('GET', '/api/transfers', officeA)
  const after = await reloaded.json() as { rides: Array<{ transferId: string, clientReference: string | null }> }
  expect(after.rides.find(ride => ride.transferId === created.transfer.id)?.clientReference).toBe('V-20')
  expect(JSON.stringify(await (await call('GET', '/api/transfers', officeB)).json())).not.toContain('V-20')

  const audit = await ownerPool.query<{ data: unknown }>(
    `select data from app.audit_entry where tenant_id = $1 and action::text in ('transfer.created', 'transfer.corrected')`,
    [firmA.tenantId],
  )
  const auditText = JSON.stringify(audit.rows)
  expect(auditText).not.toContain('V-19')
  expect(auditText).not.toContain('V-20')
  expect(auditText).toContain('clientReference')
})

it('an office user of Tenant B cannot record a Transfer that names Tenant A, and nothing is written', async () => {
  const firmA = await tenant('htr-cross-a', 'Ana Admin')
  const firmB = await tenant('htr-cross-b', 'Boris Admin')
  await addMember(firmB.tenantId, 'htr-cross-b-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const officeA = await signIn('htr-cross-a-admin@example.test')
  const officeB = await signIn('htr-cross-b-dispatcher@example.test')
  const client = await createClient(officeA, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(officeA, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(officeA, { name: 'Hotel Park', kind: 'hotel' })
  const ownClient = await createClient(officeB, { name: 'Hotel Sunce', kind: 'hotel' })
  const ownStart = await createLocation(officeB, { name: 'Zračna luka Split', kind: 'airport' })
  const ownEnd = await createLocation(officeB, { name: 'Hotel More', kind: 'hotel' })

  const beforeA = await tenantCounts(firmA.tenantId)
  const beforeB = await tenantCounts(firmB.tenantId)
  const body = {
    pickupAt: pickupOnOpenBoard(),
    passengerCount: 1,
    guestName: guest,
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }

  const foreignClient = await call('POST', '/api/transfers', officeB, {
    ...body,
    clientId: client.id,
    startLocationId: ownStart.id,
    endLocationId: ownEnd.id,
  })
  expect(foreignClient.status).toBe(404)
  expect(await foreignClient.text()).not.toContain(guest)

  const foreignStart = await call('POST', '/api/transfers', officeB, {
    ...body,
    clientId: ownClient.id,
    startLocationId: start.id,
    endLocationId: ownEnd.id,
  })
  expect(foreignStart.status).toBe(404)

  const foreignEnd = await call('POST', '/api/transfers', officeB, {
    ...body,
    clientId: ownClient.id,
    startLocationId: ownStart.id,
    endLocationId: end.id,
  })
  expect(foreignEnd.status).toBe(404)

  expect(await tenantCounts(firmA.tenantId)).toEqual(beforeA)
  expect(await tenantCounts(firmB.tenantId)).toEqual(beforeB)

  const recorded = await call('POST', '/api/transfers', officeA, {
    ...body,
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
    tabla,
  })
  expect(recorded.status).toBe(200)
  const hiddenDay = await call('GET', '/api/transfers', officeB)
  expect(await hiddenDay.text()).not.toContain(tabla)
  expect(JSON.stringify(await readOfficeHome(officeB))).not.toContain(tabla)
  const ownDay = await call('GET', '/api/transfers', officeA)
  expect(await ownDay.text()).toContain(tabla)
})

it('refuses a pickup earlier than 30 days or later than 18 months, and writes nothing', async () => {
  const created = await tenant('htr-window', 'Hana Admin')
  await addMember(created.tenantId, 'htr-window-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-window-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const before = await tenantCounts(created.tenantId)
  const body = {
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 1,
    guestName: guest,
    price: 10,
    payment: 'cash' as const,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }
  const tooEarly = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
  const tooLate = new Date(Date.now())
  tooLate.setUTCMonth(tooLate.getUTCMonth() + 19)

  const early = await call('POST', '/api/transfers', dispatcher, { ...body, pickupAt: tooEarly })
  expect(early.status).toBe(400)
  expect(await early.text()).not.toContain(guest)

  const late = await call('POST', '/api/transfers', dispatcher, { ...body, pickupAt: tooLate.toISOString() })
  expect(late.status).toBe(400)
  expect(await late.text()).not.toContain(guest)
  expect(await tenantCounts(created.tenantId)).toEqual(before)
})

it('refuses the same start and end place, and writes nothing', async () => {
  const created = await tenant('htr-same', 'Hana Admin')
  await addMember(created.tenantId, 'htr-same-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-same-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const before = await tenantCounts(created.tenantId)

  const refused = await call('POST', '/api/transfers', dispatcher, {
    clientId: client.id,
    pickupAt: pickupInsideWindow(),
    startLocationId: start.id,
    endLocationId: start.id,
    passengerCount: 1,
    guestName: guest,
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  expect(refused.status).toBe(400)
  expect(await refused.text()).not.toContain(guest)
  expect(await tenantCounts(created.tenantId)).toEqual(before)
})

it('lists a Zagreb operational day from local 05:00, including a daylight-saving night', async () => {
  const created = await tenant('htr-dst', 'Hana Admin')
  await addMember(created.tenantId, 'htr-dst-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-dst-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const seed = (pickupAt: string, guestName: string) => seedRide(
    created.tenantId,
    client.id,
    start.id,
    end.id,
    pickupAt,
    guestName,
  )

  await seed(zagrebInstant('2026-10-07T23:30'), 'Evening')
  await seed(zagrebInstant('2026-10-08T00:30'), 'Half past')
  await seed(zagrebInstant('2026-10-08T04:59'), 'Before five')
  await seed(zagrebInstant('2026-10-08T05:00'), 'Five')
  // The spring-forward is 02:00 on 29 March, still inside the day that started on 28 March.
  await seed(zagrebInstant('2026-03-28T05:00'), 'Short start')
  await seed(zagrebInstant('2026-03-29T04:59'), 'Short late')
  await seed(zagrebInstant('2026-03-29T05:00'), 'Short next')
  // The fall-back repeats 02:30 on 25 October, still inside the day that started on 24 October.
  await seed(zagrebInstant('2026-10-24T05:00'), 'Long start')
  await seed('2026-10-25T00:30:00.000Z', 'Long first')
  await seed(zagrebInstant('2026-10-25T02:30'), 'Long second')
  await seed(zagrebInstant('2026-10-25T04:59'), 'Long late')
  await seed(zagrebInstant('2026-10-25T05:00'), 'Long next')

  expect(await listedGuests(dispatcher, '2026-10-07')).toEqual(['Evening', 'Half past', 'Before five'])
  expect(await listedGuests(dispatcher, '2026-10-08')).toEqual(['Five'])
  expect(await listedGuests(dispatcher, '2026-03-28')).toEqual(['Short start', 'Short late'])
  expect(await listedGuests(dispatcher, '2026-03-29')).toEqual(['Short next'])
  expect(await listedGuests(dispatcher, '2026-10-24')).toEqual(['Long start', 'Long first', 'Long second', 'Long late'])
  expect(await listedGuests(dispatcher, '2026-10-25')).toEqual(['Long next'])
})

it('opens the board on the operational day that contains now, including before 05:00', async () => {
  const created = await tenant('htr-open', 'Hana Admin')
  await addMember(created.tenantId, 'htr-open-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-open-dispatcher@example.test')
  const beforeFive = instantFromWallClock('2026-10-08T04:30', 'Europe/Zagreb')
  const atFive = instantFromWallClock('2026-10-08T05:00', 'Europe/Zagreb')

  expect((await listTransferDay(dispatcher, undefined, beforeFive)).date).toBe('2026-10-07')
  expect((await listTransferDay(dispatcher, undefined, atFive)).date).toBe('2026-10-08')
})

it('uses the stored hour, so 06:00 starts the day and a pickup one minute earlier moves to the previous day', async () => {
  const created = await tenant('htr-hour', 'Hana Admin')
  await addMember(created.tenantId, 'htr-hour-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const admin = await signIn('htr-hour-admin@example.test')
  const dispatcher = await signIn('htr-hour-dispatcher@example.test')
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Park', kind: 'hotel' })
  const before = zagrebInstant('2026-10-08T05:59')
  const atHour = zagrebInstant('2026-10-08T06:00')
  await seedRide(created.tenantId, client.id, start.id, end.id, before, 'Before six')
  await seedRide(created.tenantId, client.id, start.id, end.id, atHour, 'At six')

  expect(await listedGuests(dispatcher, '2026-10-08')).toEqual(['Before six', 'At six'])
  expect(await listedGuests(dispatcher, '2026-10-07')).toEqual([])

  await ownerPool.query(
    'update app.tenant_settings set operational_day_start_hour = 6 where tenant_id = $1',
    [created.tenantId],
  )

  expect(await listedGuests(dispatcher, '2026-10-08')).toEqual(['At six'])
  expect(await listedGuests(dispatcher, '2026-10-07')).toEqual(['Before six'])
  const stored = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where tenant_id = $1 order by pickup_at',
    [created.tenantId],
  )
  expect(stored.rows.map(row => new Date(row.pickup_at).toISOString())).toEqual([before, atHour])
  expect((await listTransferDay(dispatcher, undefined, instantFromWallClock('2026-10-08T05:30', 'Europe/Zagreb'))).date).toBe('2026-10-07')
})

function correctionBody(
  clientId: string,
  startLocationId: string,
  endLocationId: string,
  pickupAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    clientId,
    pickupAt,
    startLocationId,
    endLocationId,
    passengerCount: 2,
    guestName: guest,
    flightNumber: flight,
    price: 42.5,
    payment: 'cash',
    airportMark: true,
    luggageCount: 1,
    childSeatCount: 0,
    note,
    tabla,
    ...overrides,
  }
}

async function correctionAudits(tenantId: string) {
  const result = await ownerPool.query<{
    action: string
    actor_user_id: string
    subject_user_id: string | null
    data: Record<string, unknown>
  }>(
    `select action::text as action, actor_user_id, subject_user_id, data
     from app.audit_entry
     where tenant_id = $1 and action::text in ('transfer.corrected', 'ride.returned_to_assigned')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
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

function driverInput(name: string, phone: string) {
  return {
    name,
    kind: 'own' as const,
    phone,
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  }
}

function vehicleInput(registrationPlate: string) {
  return {
    registrationPlate,
    kind: 'fixed' as const,
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  }
}

async function rideFacts(rideId: string) {
  const result = await ownerPool.query<{
    state: string
    driver_id: string | null
    vehicle_id: string | null
    must_accept: boolean | null
  }>(
    'select state, driver_id, vehicle_id, must_accept from app.rides where id = $1',
    [rideId],
  )
  return result.rows[0]
}

async function storedTransfer(transferId: string) {
  const result = await ownerPool.query<{
    guest_name: string
    payment: string
    flight_number: string | null
    landing_at: Date | null
    airport_mark: boolean
    expected_arrival_at: Date | null
    expected_arrival_basis_at: Date | null
    flight_will_not_arrive: boolean
    flight_will_not_arrive_handed: boolean
  }>(
    `select guest_name, payment, flight_number, landing_at, airport_mark,
            expected_arrival_at, expected_arrival_basis_at,
            flight_will_not_arrive, flight_will_not_arrive_handed
     from app.transfers where id = $1`,
    [transferId],
  )
  return result.rows[0]
}

/** The live-flight facts a designator change must clear or keep. */
async function rememberLiveFlight(transferId: string, at: string): Promise<void> {
  await ownerPool.query(
    `update app.transfers
     set landing_at = $2,
         expected_arrival_at = $2,
         expected_arrival_basis_at = $2,
         flight_will_not_arrive = true,
         flight_will_not_arrive_handed = true
     where id = $1`,
    [transferId, at],
  )
}

it('refuses a bad correction before a session opens, and no session is 401', async () => {
  const refused = await call('PATCH', '/api/transfers/not-a-transfer', undefined, { guestName: guest })
  expect(refused.status).toBe(400)
  expect(await refused.text()).not.toContain(guest)
  expect((await call('PATCH', '/api/transfers/9e4b3f6d-5555-4555-8555-555555555555', undefined, {
    ...correctionBody(
      '9e4b3f6d-5555-4555-8555-555555555555',
      'a1b2c3d4-5555-4555-8555-555555555555',
      'b1b2c3d4-6666-4666-8666-666666666666',
      pickupInsideWindow(),
    ),
    guestName: '   ',
  })).status).toBe(400)
  expect((await call('PATCH', '/api/transfers/9e4b3f6d-5555-4555-8555-555555555555', undefined, correctionBody(
    '9e4b3f6d-5555-4555-8555-555555555555',
    'a1b2c3d4-5555-4555-8555-555555555555',
    'b1b2c3d4-6666-4666-8666-666666666666',
    pickupInsideWindow(),
  ))).status).toBe(401)
})

it('a driver cannot correct a Transfer, and the booking is unchanged', async () => {
  const created = await tenant('htr-correct-driver', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-driver-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'htr-correct-driver-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-driver-dispatcher@example.test')
  const driver = await signIn('htr-correct-driver-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupInsideWindow()))
  expect(recorded.status).toBe(200)
  const body = await recorded.json() as { transfer: { id: string } }
  const before = await correctionAudits(created.tenantId)

  const refused = await call('PATCH', `/api/transfers/${body.transfer.id}`, driver, correctionBody(client.id, start.id, end.id, pickupInsideWindow(), { guestName: 'Iva Ivić' }))
  expect(refused.status).toBe(403)
  expect(await storedTransfer(body.transfer.id)).toMatchObject({ guest_name: guest })
  expect(await correctionAudits(created.tenantId)).toEqual(before)
})

it('keeps an accepted Ride accepted when the Client, the guest, the price, the payment, or the airport mark changes, and the phone follows cash', async () => {
  const created = await tenant('htr-correct-soft', 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, 'htr-correct-soft-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverUserId = await addMember(created.tenantId, 'htr-correct-soft-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-soft-dispatcher@example.test')
  const admin = await signIn('htr-correct-soft-admin@example.test')
  const driverSession = await signIn('htr-correct-soft-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const other = await createClient(dispatcher, { name: 'Hotel Sunce', kind: 'hotel' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911110941',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9411AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = pickupInsideWindow()
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await acceptRide(driverSession, createdBody.ride.id, {})
  expect((await listUpcomingRides(driverSession)).rides[0]).toMatchObject({
    state: 'accepted',
    price: '42.50',
    payment: 'cash',
  })

  const corrected = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(other.id, start.id, end.id, pickupAt, {
    guestName: 'Iva Ivić',
    price: 10,
    payment: 'card',
    airportMark: false,
  }))
  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({
    transfer: { guestName: 'Iva Ivić', payment: 'card', airportMark: false, price: '10.00', clientId: other.id },
    ride: { state: 'accepted', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })
  expect((await listUpcomingRides(driverSession)).rides[0]).toMatchObject({
    state: 'accepted',
    guestName: 'Iva Ivić',
    price: null,
    payment: null,
  })
  const audits = await correctionAudits(created.tenantId)
  expect(audits).toEqual([{
    action: 'transfer.corrected',
    actor_user_id: dispatcherId,
    subject_user_id: null,
    data: {
      transferId: createdBody.transfer.id,
      rideId: createdBody.ride.id,
      clientId: other.id,
      startLocationId: start.id,
      endLocationId: end.id,
      fields: ['clientId', 'guestName', 'price', 'payment', 'airportMark'],
    },
  }])
  const stored = JSON.stringify(audits)
  expect(stored).not.toContain('Iva Ivić')
  expect(stored).not.toContain(guest)
  expect(stored).not.toContain('10.00')
  expect(stored).not.toContain(flight)
})

it('returns an accepted Ride to assigned when the trip changes, alerts the Driver, and lets them decline', async () => {
  const created = await tenant('htr-correct-trip', 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, 'htr-correct-trip-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverUserId = await addMember(created.tenantId, 'htr-correct-trip-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-trip-dispatcher@example.test')
  const admin = await signIn('htr-correct-trip-admin@example.test')
  const driverSession = await signIn('htr-correct-trip-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const later = await createLocation(dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911110942',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9421AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = pickupOnOpenBoard()
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU384' }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await acceptRide(driverSession, createdBody.ride.id, {})
  await ownerPool.query('update app.transfers set landing_at = $2 where id = $1', [createdBody.transfer.id, pickupAt])

  const spaced = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, admin, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 384' }))
  expect(spaced.status).toBe(200)
  expect(await spaced.json()).toMatchObject({
    ride: { state: 'accepted', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })
  expect((await storedTransfer(createdBody.transfer.id))?.landing_at).not.toBeNull()
  expect((await listUpcomingRides(driverSession)).rides[0]).toMatchObject({
    state: 'accepted',
    mustAccept: true,
    flightNumber: 'OU 384',
  })

  const moved = new Date(new Date(pickupAt).getTime() + 3 * 60 * 60 * 1000).toISOString()
  const returned = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, later.id, moved, { flightNumber: 'OU392' }))
  expect(returned.status).toBe(200)
  expect(await returned.json()).toMatchObject({
    transfer: { endLocationId: later.id, flightNumber: 'OU392' },
    ride: { state: 'assigned', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })
  expect((await storedTransfer(createdBody.transfer.id))?.landing_at).toBeNull()
  expect((await listUpcomingRides(driverSession)).rides.map(ride => ride.state)).toEqual(['assigned'])

  const declined = await declineRide(driverSession, createdBody.ride.id, {})
  expect(declined.state).toBe('unassigned')
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date(moved))
  const listed = await listTransferDay(dispatcher, day)
  expect(listed.declineAlerts.map(alert => alert.driverName)).toEqual(['Drago Driver'])

  const audits = await correctionAudits(created.tenantId)
  expect(audits.filter(row => row.action === 'ride.returned_to_assigned')).toEqual([
    {
      action: 'ride.returned_to_assigned',
      actor_user_id: dispatcherId,
      subject_user_id: null,
      data: { rideId: createdBody.ride.id, driverId: driver.id, fields: ['state'] },
    },
  ])
  expect(JSON.stringify(audits)).not.toContain('OU392')
  expect(JSON.stringify(audits)).not.toContain(guest)
})

it('clears live-flight facts when the flight designator changes, and returns an accepted Ride to assigned', async () => {
  const created = await tenant('htr-correct-designator', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-designator-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverUserId = await addMember(created.tenantId, 'htr-correct-designator-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-designator-dispatcher@example.test')
  const admin = await signIn('htr-correct-designator-admin@example.test')
  const driverSession = await signIn('htr-correct-designator-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911110944',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9441AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = pickupOnOpenBoard()
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 384' }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await acceptRide(driverSession, createdBody.ride.id, {})
  await rememberLiveFlight(createdBody.transfer.id, pickupAt)

  const changed = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 392' }))
  expect(changed.status).toBe(200)
  expect(await changed.json()).toMatchObject({
    transfer: { flightNumber: 'OU 392' },
    ride: { state: 'assigned', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })
  const stored = await storedTransfer(createdBody.transfer.id)
  expect(stored).toMatchObject({
    flight_number: 'OU 392',
    landing_at: null,
    expected_arrival_at: null,
    expected_arrival_basis_at: null,
    flight_will_not_arrive: false,
    flight_will_not_arrive_handed: false,
  })
  expect((await listUpcomingRides(driverSession)).rides[0]).toMatchObject({
    state: 'assigned',
    flightNumber: 'OU 392',
    landingAt: null,
    expectedArrival: null,
  })
})

it('keeps live-flight facts and acceptance when only the flight designator spacing or case changes', async () => {
  const created = await tenant('htr-correct-spacing', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-spacing-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverUserId = await addMember(created.tenantId, 'htr-correct-spacing-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-spacing-dispatcher@example.test')
  const admin = await signIn('htr-correct-spacing-admin@example.test')
  const driverSession = await signIn('htr-correct-spacing-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911110945',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9451AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = pickupOnOpenBoard()
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 384' }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await acceptRide(driverSession, createdBody.ride.id, {})
  await rememberLiveFlight(createdBody.transfer.id, pickupAt)

  const spaced = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'ou384' }))
  expect(spaced.status).toBe(200)
  expect(await spaced.json()).toMatchObject({
    transfer: { flightNumber: 'ou384' },
    ride: { state: 'accepted', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })
  const stored = await storedTransfer(createdBody.transfer.id)
  expect(stored?.flight_number).toBe('ou384')
  expect(stored?.landing_at?.toISOString()).toBe(pickupAt)
  expect(stored?.expected_arrival_at?.toISOString()).toBe(pickupAt)
  expect(stored?.expected_arrival_basis_at?.toISOString()).toBe(pickupAt)
  expect(stored).toMatchObject({
    flight_will_not_arrive: true,
    flight_will_not_arrive_handed: true,
  })
  expect((await listUpcomingRides(driverSession)).rides[0]).toMatchObject({
    state: 'accepted',
    flightNumber: 'ou384',
    landingAt: pickupAt,
    expectedArrival: pickupAt,
  })
})

it('leaves an assigned Ride assigned, and a save of the same trip writes nothing', async () => {
  const created = await tenant('htr-correct-same', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-same-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driverUserId = await addMember(created.tenantId, 'htr-correct-same-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('htr-correct-same-dispatcher@example.test')
  const admin = await signIn('htr-correct-same-admin@example.test')
  const driverSession = await signIn('htr-correct-same-driver@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911110943',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9431AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  const before = await correctionAudits(created.tenantId)

  const sameAssigned = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 392' }))
  expect(sameAssigned.status).toBe(200)
  expect(await sameAssigned.json()).toMatchObject({
    ride: { state: 'assigned', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true },
  })

  await acceptRide(driverSession, createdBody.ride.id, {})
  const quiet = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 392' }))
  expect(quiet.status).toBe(200)
  expect(await quiet.json()).toMatchObject({ ride: { state: 'accepted' } })
  const audits = await correctionAudits(created.tenantId)
  expect(audits.filter(row => row.action === 'transfer.corrected')).toHaveLength(before.length + 1)
  expect(audits.filter(row => row.action === 'ride.returned_to_assigned')).toEqual([])
})

it('refuses a finished Ride and writes nothing', async () => {
  const created = await tenant('htr-correct-closed', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-closed-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-correct-closed-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  for (const state of ['done', 'no-show', 'cancelled'] as const) {
    const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()))
    const body = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
    await ownerPool.query('update app.rides set state = $2 where id = $1', [body.ride.id, state])
    const before = await correctionAudits(created.tenantId)
    const refused = await call('PATCH', `/api/transfers/${body.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), { guestName: 'Iva Ivić' }))
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('transfer_closed')
    expect(await storedTransfer(body.transfer.id)).toMatchObject({ guest_name: guest })
    expect(await correctionAudits(created.tenantId)).toEqual(before)
  }
})

it('refuses a flight-number change on a finished Ride and keeps the live-flight facts', async () => {
  const created = await tenant('htr-correct-closed-flight', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-closed-flight-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-correct-closed-flight-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  for (const state of ['done', 'no-show', 'cancelled'] as const) {
    const pickupAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 384' }))
    const body = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
    await ownerPool.query('update app.rides set state = $2 where id = $1', [body.ride.id, state])
    await rememberLiveFlight(body.transfer.id, pickupAt)
    const before = await correctionAudits(created.tenantId)
    const refused = await call('PATCH', `/api/transfers/${body.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU 392' }))
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('transfer_closed')
    const stored = await storedTransfer(body.transfer.id)
    expect(stored?.flight_number).toBe('OU 384')
    expect(stored?.landing_at?.toISOString()).toBe(pickupAt)
    expect(stored?.expected_arrival_at?.toISOString()).toBe(pickupAt)
    expect(stored?.expected_arrival_basis_at?.toISOString()).toBe(pickupAt)
    expect(stored).toMatchObject({
      flight_will_not_arrive: true,
      flight_will_not_arrive_handed: true,
    })
    expect(await correctionAudits(created.tenantId)).toEqual(before)
  }
})

it('another Tenant cannot correct the Transfer', async () => {
  const firmA = await tenant('htr-correct-a', 'Hana Admin')
  const firmB = await tenant('htr-correct-b', 'Ivo Admin')
  await addMember(firmA.tenantId, 'htr-correct-a-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(firmB.tenantId, 'htr-correct-b-dispatcher@example.test', 'Ema Dispatcher', 'dispatcher')
  const officeA = await signIn('htr-correct-a-dispatcher@example.test')
  const officeB = await signIn('htr-correct-b-dispatcher@example.test')
  const client = await createClient(officeA, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(officeA, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(officeA, { name: 'Hotel Park', kind: 'hotel' })
  const recorded = await call('POST', '/api/transfers', officeA, correctionBody(client.id, start.id, end.id, pickupInsideWindow()))
  const body = await recorded.json() as { transfer: { id: string } }
  const before = await correctionAudits(firmA.tenantId)

  const refused = await call('PATCH', `/api/transfers/${body.transfer.id}`, officeB, correctionBody(client.id, start.id, end.id, pickupInsideWindow(), { guestName: 'Iva Ivić' }))
  expect(refused.status).toBe(404)
  expect(await storedTransfer(body.transfer.id)).toMatchObject({ guest_name: guest })
  expect(await correctionAudits(firmA.tenantId)).toEqual(before)
  expect(await correctionAudits(firmB.tenantId)).toEqual([])
})

it('refuses an archived Location and writes nothing', async () => {
  const created = await tenant('htr-correct-archived', 'Hana Admin')
  await addMember(created.tenantId, 'htr-correct-archived-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-correct-archived-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const hidden = await createLocation(dispatcher, { name: 'Stari hotel', kind: 'hotel' })
  await archiveLocation(dispatcher, hidden.id)
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupInsideWindow()))
  const body = await recorded.json() as { transfer: { id: string } }
  const before = await correctionAudits(created.tenantId)

  const refused = await call('PATCH', `/api/transfers/${body.transfer.id}`, dispatcher, correctionBody(client.id, start.id, hidden.id, pickupInsideWindow()))
  expect(refused.status).toBe(409)
  expect(await storedTransfer(body.transfer.id)).toMatchObject({ guest_name: guest })
  expect(await correctionAudits(created.tenantId)).toEqual(before)
})

interface SentWorkOrder { to: string, subject: string, text: string }

function workOrderMailer(sent: SentWorkOrder[]) {
  return {
    async sendInvitation() {},
    async sendWorkOrder(mail: SentWorkOrder) {
      sent.push({ to: mail.to, subject: mail.subject, text: mail.text })
    },
    async notifyArrivalMoved() {},
    async notifyFlightWillNotArrive() {},
    async sendPasswordChanged() {},
  }
}

function expectNoPaymentLine(text: string) {
  expect(text).not.toContain('Cijena')
  expect(text).not.toContain('Plaćanje')
  expect(text).not.toContain('Gotovina')
  expect(text).not.toContain('Kartica')
  expect(text).not.toContain('voucher')
  expect(text).not.toContain('Vaučer')
  expect(text).not.toContain('ne naplać')
}

it('emails one changed work order for each mailed fact, and a quiet save sends nothing', async () => {
  const created = await tenant('htr-wo-fields', 'Hana Admin')
  await addMember(created.tenantId, 'htr-wo-fields-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-wo-fields-dispatcher@example.test')
  await updateUserLocale(dispatcher, 'en')
  const address = 'ana-correct@example.test'
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const other = await createClient(dispatcher, { name: 'Hotel Sunce', kind: 'hotel' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const split = await createLocation(dispatcher, { name: 'Zračna luka Split', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const later = await createLocation(dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Ana Correct',
    kind: 'own',
    phone: '+385911111681',
    email: address,
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  })
  const blank = await createDriver(dispatcher, {
    name: 'Marko Blank',
    kind: 'own',
    phone: '+385911111682',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9168AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = '2026-10-15T22:30:00.000Z'
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, {
    flightNumber: 'OU 384',
    note: 'Čeka',
    tabla: 'GOSPOĐA',
  }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  const sent: SentWorkOrder[] = []
  const mailer = workOrderMailer(sent)
  let body = correctionBody(client.id, start.id, end.id, pickupAt, {
    flightNumber: 'OU 384',
    note: 'Čeka',
    tabla: 'GOSPOĐA',
  })

  async function correct(overrides: Record<string, unknown> = {}) {
    body = { ...body, ...overrides }
    return correctTransfer(dispatcher, createdBody.transfer.id, body, { mailer })
  }

  async function expectOne(overrides: Record<string, unknown>, fact: string) {
    const before = sent.length
    const result = await correct(overrides)
    expect(result.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
    expect(JSON.stringify(result)).not.toContain(address)
    expect(sent).toHaveLength(before + 1)
    expect(sent.at(-1)?.to).toBe(address)
    expect(sent.at(-1)?.text.startsWith('Promijenjeno\n')).toBe(true)
    expect(sent.at(-1)?.text).toContain(fact)
    expect(sent.at(-1)?.text).toContain('Registracija: ZG9168AA')
    expect(sent.at(-1)?.text).not.toContain('http')
    expect(sent.at(-1)?.text).not.toContain('Prihvati')
  }

  await expectOne({ guestName: 'Iva Nova' }, 'Gost: Iva Nova')
  expect(sent[0]?.subject).toBe('Promijenjeno · 16. 10. 2026. 00:30 · Zračna luka Dubrovnik')
  expect(sent[0]?.text).toContain('Cijena: 42,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  await expectOne({ passengerCount: 4 }, 'Putnici: 4')
  await expectOne({ luggageCount: 3 }, 'Prtljaga: 3')
  await expectOne({ childSeatCount: 2 }, 'Dječje sjedalice: 2')
  await expectOne({ flightNumber: 'OU392' }, 'Let: OU392')
  await expectOne({ note: 'Nova napomena' }, 'Napomena: Nova napomena')
  await expectOne({ tabla: 'NOVA TABLA' }, 'Tabla: NOVA TABLA')
  await expectOne({ pickupAt: '2026-10-16T22:30:00.000Z' }, 'Polazak: 17. 10. 2026. 00:30')
  expect(sent.at(-1)?.subject).toBe('Promijenjeno · 17. 10. 2026. 00:30 · Zračna luka Dubrovnik')
  await expectOne({ startLocationId: split.id }, 'Polazište: Zračna luka Split')
  expect(sent.at(-1)?.subject).toBe('Promijenjeno · 17. 10. 2026. 00:30 · Zračna luka Split')
  await expectOne({ endLocationId: later.id }, 'Odredište: Hotel Excelsior')
  await expectOne({ clientId: other.id }, 'Klijent: Hotel Sunce')

  const beforeSeveral = sent.length
  const several = await correct({
    guestName: 'Leo Više',
    note: 'Drugi ulaz',
    passengerCount: 5,
    luggageCount: 4,
  })
  expect(several.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent).toHaveLength(beforeSeveral + 1)
  expect(sent.at(-1)?.text).toContain('Gost: Leo Više')
  expect(sent.at(-1)?.text).toContain('Napomena: Drugi ulaz')
  expect(sent.at(-1)?.text).toContain('Putnici: 5')
  expect(sent.at(-1)?.text).toContain('Prtljaga: 4')

  const quiet = await correct()
  expect(quiet.workOrders).toEqual([])
  expect(sent).toHaveLength(beforeSeveral + 1)

  const referenceOnly = await correct({ clientReference: 'V-19' })
  expect(referenceOnly.workOrders).toEqual([])
  expect(referenceOnly.transfer.clientReference).toBe('V-19')
  expect(sent).toHaveLength(beforeSeveral + 1)

  const previous = sent.at(-1)?.text
  const marked = await correct({ airportMark: false })
  expect(marked.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent.at(-1)?.text).toBe(previous)

  const openRecorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, '2026-10-17T10:00:00.000Z'))
  const openBody = await openRecorded.json() as { transfer: { id: string } }
  const beforeOpen = sent.length
  const open = await correctTransfer(dispatcher, openBody.transfer.id, correctionBody(client.id, start.id, end.id, '2026-10-17T10:00:00.000Z', {
    guestName: 'Nitko Gost',
  }), { mailer })
  expect(open.workOrders).toEqual([])
  expect(open.ride.driverId).toBeNull()
  expect(sent).toHaveLength(beforeOpen)

  const blankRecorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, '2026-10-17T16:00:00.000Z'))
  const blankBody = await blankRecorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: blankBody.ride.id, driverId: blank.id, vehicleId: vehicle.id })
  const noEmail = await correctTransfer(dispatcher, blankBody.transfer.id, correctionBody(client.id, start.id, end.id, '2026-10-17T16:00:00.000Z', {
    guestName: 'Bez Adrese',
  }), { mailer })
  expect(noEmail.workOrders).toEqual([{ driverId: blank.id, outcome: 'no_email' }])
  expect(sent).toHaveLength(beforeOpen)
  expect(JSON.stringify(noEmail)).not.toContain(address)

  const viaRoute = await call('PATCH', `/api/transfers/${createdBody.transfer.id}`, dispatcher, {
    ...body,
    guestName: 'Ruta Gost',
  })
  expect(viaRoute.status).toBe(200)
  const routed = await viaRoute.json()
  expect(routed.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(JSON.stringify(routed)).not.toContain(address)
})

it('mails a price change only while payment is cash, and a payment-method change always', async () => {
  const created = await tenant('htr-wo-pay', 'Hana Admin')
  await addMember(created.tenantId, 'htr-wo-pay-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-wo-pay-dispatcher@example.test')
  const address = 'ana-pay@example.test'
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Ana Pay',
    kind: 'own',
    phone: '+385911111683',
    email: address,
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9168BB',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = '2026-10-15T22:30:00.000Z'
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  const sent: SentWorkOrder[] = []
  const mailer = workOrderMailer(sent)
  let body = correctionBody(client.id, start.id, end.id, pickupAt)

  async function correct(overrides: Record<string, unknown> = {}) {
    body = { ...body, ...overrides }
    return correctTransfer(dispatcher, createdBody.transfer.id, body, { mailer })
  }

  const raised = await correct({ price: 55.5 })
  expect(raised.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('Cijena: 55,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  const again = await correct({ price: 10 })
  expect(again.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent[1]?.text).toContain('Cijena: 10,00')

  const card = await correct({ payment: 'card' })
  expect(card.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expectNoPaymentLine(sent[2]?.text ?? '')
  const hidden = await correct({ price: 12 })
  expect(hidden.workOrders).toEqual([])
  expect(hidden.transfer.price).toBe('12.00')
  expect(sent).toHaveLength(3)

  const invoice = await correct({ payment: 'invoice_to_agency' })
  expect(invoice.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent[3]?.text).toBe(sent[2]?.text)
  expectNoPaymentLine(sent[3]?.text ?? '')
  const stillHidden = await correct({ price: 18 })
  expect(stillHidden.workOrders).toEqual([])
  expect(stillHidden.transfer.price).toBe('18.00')
  expect(sent).toHaveLength(4)

  const cash = await correct({ payment: 'cash' })
  expect(cash.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent[4]?.text).toContain('Cijena: 18,00')
  expect(sent[4]?.text).toContain('Plaćanje: Gotovina')
  const removed = await correct({ payment: 'card' })
  expect(removed.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent[5]?.text).toBe(sent[3]?.text)
  expectNoPaymentLine(sent[5]?.text ?? '')
  expect(JSON.stringify(removed)).not.toContain(address)
})

it('a rejected send leaves the correction, and the audit stays the correction', async () => {
  const created = await tenant('htr-wo-fail', 'Hana Admin')
  const dispatcherId = await addMember(created.tenantId, 'htr-wo-fail-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-wo-fail-dispatcher@example.test')
  const address = 'ana-fail@example.test'
  const guestName = 'Gost Odbijen'
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Ana Fail',
    kind: 'own',
    phone: '+385911111684',
    email: address,
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9168CC',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = '2026-10-15T22:30:00.000Z'
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, {
    guestName,
    tabla: 'TABLA ODBIJENA',
    price: 77.5,
  }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  const logs = captureLogs()
  const failed = await correctTransfer(dispatcher, createdBody.transfer.id, correctionBody(client.id, start.id, end.id, pickupAt, {
    guestName: 'Iva Ostaje',
    tabla: 'TABLA ODBIJENA',
    price: 77.5,
  }), {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder() {
        throw new Error(`rejected ${address} ${guestName} TABLA ODBIJENA ZG9168CC`)
      },
      async notifyArrivalMoved() {},
      async notifyFlightWillNotArrive() {},
      async sendPasswordChanged() {},
    },
  })
  expect(failed.workOrders).toEqual([{ driverId: driver.id, outcome: 'failed' }])
  expect(failed.transfer.guestName).toBe('Iva Ostaje')
  expect(await storedTransfer(createdBody.transfer.id)).toMatchObject({ guest_name: 'Iva Ostaje' })
  expect(JSON.stringify(failed)).not.toContain(address)
  const audits = await correctionAudits(created.tenantId)
  expect(audits.map(row => row.action)).toEqual(['transfer.corrected'])
  expect(audits[0]?.actor_user_id).toBe(dispatcherId)
  expect(JSON.stringify(audits)).not.toContain(address)
  expect(JSON.stringify(audits)).not.toContain('email')
  expect(JSON.stringify(audits)).not.toContain('Iva Ostaje')
  expect(JSON.stringify(audits)).not.toContain(guestName)
  const line = JSON.stringify(logs.lines()[0])
  expect(line).toContain(createdBody.ride.id)
  expect(line).toContain(driver.id)
  expect(line).not.toContain(address)
  expect(line).not.toContain(guestName)
  expect(line).not.toContain('TABLA ODBIJENA')
  expect(line).not.toContain('ZG9168CC')
  expect(line).not.toContain('77.50')
  expect(line).not.toContain('77,50')
  expect(line).not.toContain('Zračna luka Dubrovnik')
})

it('a change that returns an accepted Ride to assigned uses changed and does not ask the Driver to accept', async () => {
  const created = await tenant('htr-wo-accept', 'Hana Admin')
  const driverUserId = await addMember(created.tenantId, 'htr-wo-accept-driver@example.test', 'Drago Driver', 'driver')
  await addMember(created.tenantId, 'htr-wo-accept-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-wo-accept-dispatcher@example.test')
  const admin = await signIn('htr-wo-accept-admin@example.test')
  const driverSession = await signIn('htr-wo-accept-driver@example.test')
  const address = 'htr-wo-accept-driver@example.test'
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const later = await createLocation(dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Accept',
    kind: 'own',
    phone: '+385911111685',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG9168DD',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const pickupAt = '2026-10-15T22:30:00.000Z'
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, pickupAt, { flightNumber: 'OU384' }))
  const createdBody = await recorded.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: createdBody.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await acceptRide(driverSession, createdBody.ride.id, {})
  const sent: SentWorkOrder[] = []
  const mailer = workOrderMailer(sent)

  const spaced = await correctTransfer(dispatcher, createdBody.transfer.id, correctionBody(client.id, start.id, end.id, pickupAt, {
    flightNumber: 'OU 384',
  }), { mailer })
  expect(spaced.ride).toMatchObject({ state: 'accepted', driverId: driver.id, mustAccept: true })
  expect(spaced.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent[0]?.text.startsWith('Promijenjeno\n')).toBe(true)
  expect(sent[0]?.text).toContain('Let: OU 384')
  expect(sent[0]?.text).not.toContain('Prihvati')
  expect(sent[0]?.subject.startsWith('Promijenjeno ·')).toBe(true)

  const returned = await correctTransfer(dispatcher, createdBody.transfer.id, correctionBody(client.id, start.id, later.id, pickupAt, {
    flightNumber: 'OU392',
  }), { mailer })
  expect(returned.ride).toMatchObject({ state: 'assigned', driverId: driver.id, vehicleId: vehicle.id, mustAccept: true })
  expect(returned.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent).toHaveLength(2)
  expect(sent[1]?.text.startsWith('Promijenjeno\n')).toBe(true)
  expect(sent[1]?.text).toContain('Let: OU392')
  expect(sent[1]?.text).toContain('Odredište: Hotel Excelsior')
  expect(sent[1]?.text).not.toContain('Dodijeljeno')
  expect(sent[1]?.text).not.toContain('Prihvati')
  expect(sent[1]?.text).not.toContain('http')
  expect(JSON.stringify(returned)).not.toContain(address)
  const audits = await correctionAudits(created.tenantId)
  expect(audits.map(row => row.action).sort()).toEqual([
    'ride.returned_to_assigned',
    'transfer.corrected',
    'transfer.corrected',
  ])
  expect(JSON.stringify(audits)).not.toContain(address)
  expect(JSON.stringify(audits)).not.toContain('email')
})

it('refuses a pickup correction that overlaps the Driver and writes nothing', async () => {
  const created = await tenant('htr-ovlp-driver', 'Hana Admin')
  await addMember(created.tenantId, 'htr-ovlp-driver-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn('htr-ovlp-driver-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Drago Driver',
    kind: 'own',
    phone: '+385911112130',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
  })
  const heldVehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG2130AA',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const movingVehicle = await createVehicle(dispatcher, {
    registrationPlate: 'ZG2130BB',
    kind: 'fixed',
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const heldAt = '2026-11-02T10:00:00.000Z'
  const movingAt = '2026-11-02T14:00:00.000Z'
  const held = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, heldAt))
  const moving = await call('POST', '/api/transfers', dispatcher, correctionBody(client.id, start.id, end.id, movingAt))
  const heldBody = await held.json() as { ride: { id: string } }
  const movingBody = await moving.json() as { transfer: { id: string }, ride: { id: string } }
  await assignRide(dispatcher, { rideId: heldBody.ride.id, driverId: driver.id, vehicleId: heldVehicle.id })
  await assignRide(dispatcher, { rideId: movingBody.ride.id, driverId: driver.id, vehicleId: movingVehicle.id })
  const before = await correctionAudits(created.tenantId)
  const sent: SentWorkOrder[] = []

  const refused = await call('PATCH', `/api/transfers/${movingBody.transfer.id}`, dispatcher, correctionBody(client.id, start.id, end.id, '2026-11-02T10:30:00.000Z'))
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_overlap')
  expect(await storedTransfer(movingBody.transfer.id)).toMatchObject({ guest_name: guest })
  expect((await rideFacts(movingBody.ride.id))).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: movingVehicle.id,
  })
  const pickup = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where id = $1',
    [movingBody.transfer.id],
  )
  expect(pickup.rows[0]?.pickup_at.toISOString()).toBe(movingAt)
  expect(await correctionAudits(created.tenantId)).toEqual(before)

  await expect(correctTransfer(dispatcher, movingBody.transfer.id, correctionBody(client.id, start.id, end.id, '2026-11-02T10:30:00.000Z'), {
    mailer: workOrderMailer(sent),
  })).rejects.toMatchObject({ statusCode: 409, code: 'ride_overlap' })
  expect(sent).toEqual([])
  const still = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where id = $1',
    [movingBody.transfer.id],
  )
  expect(still.rows[0]?.pickup_at.toISOString()).toBe(movingAt)
})

async function bookedOffice(slug: string) {
  const created = await tenant(slug, 'Hana Admin')
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return { created, dispatcher, client, start, end }
}

async function recordRide(
  dispatcher: Headers,
  clientId: string,
  startLocationId: string,
  endLocationId: string,
  pickupAt: string,
) {
  const recorded = await call('POST', '/api/transfers', dispatcher, correctionBody(clientId, startLocationId, endLocationId, pickupAt))
  expect(recorded.status).toBe(200)
  return recorded.json() as Promise<{ transfer: { id: string }, ride: { id: string } }>
}

it('refuses a pickup correction that overlaps only the Vehicle and writes nothing', async () => {
  const office = await bookedOffice('htr-ovlp-vehicle')
  const firstDriver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112131'))
  const secondDriver = await createDriver(office.dispatcher, driverInput('Ema Driver', '+385911112132'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2131AA'))
  const heldAt = '2026-11-02T10:00:00.000Z'
  const movingAt = '2026-11-02T14:00:00.000Z'
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, heldAt)
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, movingAt)
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: firstDriver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: secondDriver.id, vehicleId: vehicle.id })
  const before = await correctionAudits(office.created.tenantId)
  const sent: SentWorkOrder[] = []

  const refused = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z'))
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_overlap')
  expect(await storedTransfer(moving.transfer.id)).toMatchObject({ guest_name: guest })
  const pickup = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where id = $1',
    [moving.transfer.id],
  )
  expect(pickup.rows[0]?.pickup_at.toISOString()).toBe(movingAt)
  expect(await rideFacts(moving.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: secondDriver.id,
    vehicle_id: vehicle.id,
  })
  expect(await correctionAudits(office.created.tenantId)).toEqual(before)
  await expect(correctTransfer(office.dispatcher, moving.transfer.id, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z'), {
    mailer: workOrderMailer(sent),
  })).rejects.toMatchObject({ statusCode: 409, code: 'ride_overlap' })
  expect(sent).toEqual([])
})

it('a confirmed overlap saves, returns an accepted Ride to assigned, and sends one changed work order', async () => {
  const office = await bookedOffice('htr-ovlp-confirm')
  const driverUserId = await addMember(office.created.tenantId, 'htr-ovlp-confirm-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('htr-ovlp-confirm-admin@example.test')
  const driverSession = await signIn('htr-ovlp-confirm-driver@example.test')
  const driver = await createDriver(office.dispatcher, {
    ...driverInput('Drago Driver', '+385911112133'),
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const heldVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2133AA'))
  const movingVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2133BB'))
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: heldVehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: movingVehicle.id })
  await acceptRide(driverSession, moving.ride.id, {})
  const sent: SentWorkOrder[] = []
  const mailer = workOrderMailer(sent)
  const clash = correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z')

  await expect(correctTransfer(office.dispatcher, moving.transfer.id, clash, { mailer })).rejects.toMatchObject({
    statusCode: 409,
    code: 'ride_overlap',
  })
  expect(await rideFacts(moving.ride.id)).toMatchObject({ state: 'accepted', driver_id: driver.id, must_accept: true })
  expect(sent).toEqual([])
  expect(await correctionAudits(office.created.tenantId)).toEqual([])

  const saved = await correctTransfer(office.dispatcher, moving.transfer.id, { ...clash, confirm: true }, { mailer })
  expect(saved.ride).toMatchObject({
    state: 'assigned',
    driverId: driver.id,
    vehicleId: movingVehicle.id,
    mustAccept: true,
  })
  expect(saved.relocationWarnings).toEqual([])
  expect(saved.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text.startsWith('Promijenjeno\n')).toBe(true)
  const audits = await correctionAudits(office.created.tenantId)
  expect(audits.map(row => row.action).sort()).toEqual(['ride.returned_to_assigned', 'transfer.corrected'])
})

it('does not judge a correction that leaves the occupied window where it was', async () => {
  const office = await bookedOffice('htr-ovlp-quiet')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112134'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2134AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2134BB'))
  const later = await createLocation(office.dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  const heldAt = '2026-11-02T10:00:00.000Z'
  const movingAt = '2026-11-02T10:30:00.000Z'
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, heldAt)
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, movingAt)
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, {
    rideId: moving.ride.id,
    driverId: driver.id,
    vehicleId: otherVehicle.id,
    confirm: true,
  })

  const guestOnly = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, movingAt, {
    guestName: 'Iva Ivić',
  }))
  expect(guestOnly.status).toBe(200)
  expect(await guestOnly.json()).toMatchObject({
    relocationWarnings: [],
    ride: { state: 'assigned' },
  })

  const placeOnly = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, later.id, movingAt, {
    guestName: 'Iva Ivić',
  }))
  expect(placeOnly.status).toBe(200)
  expect(await placeOnly.json()).toMatchObject({ relocationWarnings: [] })

  const spaced = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, later.id, movingAt, {
    guestName: 'Iva Ivić',
    flightNumber: 'ou384',
  }))
  expect(spaced.status).toBe(200)
  expect(await spaced.json()).toMatchObject({ relocationWarnings: [], ride: { state: 'assigned' } })
})

it('refuses a flight-number change that pushes the occupied end into the next Ride', async () => {
  const office = await bookedOffice('htr-ovlp-flight')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112135'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2135AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2135BB'))
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T12:00:00.000Z')
  const next = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T12:30:00.000Z')
  await rememberLiveFlight(moving.transfer.id, '2026-11-02T11:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: next.ride.id, driverId: driver.id, vehicleId: otherVehicle.id })
  const before = await correctionAudits(office.created.tenantId)

  const refused = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T12:00:00.000Z', {
    flightNumber: 'OU 392',
  }))
  expect(refused.status).toBe(409)
  const flightText = await refused.text()
  expect(flightText).toContain('ride_overlap')
  expect(flightText).not.toContain('transfer_closed')
  const stored = await storedTransfer(moving.transfer.id)
  expect(stored?.flight_number).toBe('OU 384')
  expect(stored?.landing_at?.toISOString()).toBe('2026-11-02T11:00:00.000Z')
  expect(await correctionAudits(office.created.tenantId)).toEqual(before)
})

it('lets an unassigned Ride move onto an occupied time', async () => {
  const office = await bookedOffice('htr-ovlp-free')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112136'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2136AA'))
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })

  const saved = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z'))
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({
    relocationWarnings: [],
    ride: { state: 'unassigned', driverId: null },
  })
})

it('a finished Ride stays transfer_closed when the new pickup would overlap', async () => {
  const office = await bookedOffice('htr-ovlp-closed')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112137'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2137AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2137BB'))
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: otherVehicle.id })
  await ownerPool.query('update app.rides set state = $2 where id = $1', [moving.ride.id, 'done'])

  const refused = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z'))
  expect(refused.status).toBe(409)
  const closedText = await refused.text()
  expect(closedText).toContain('transfer_closed')
  expect(closedText).not.toContain('ride_overlap')
})

it('an archived Location is refused before an overlap', async () => {
  const office = await bookedOffice('htr-ovlp-archived')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112138'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2138AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2138BB'))
  const hidden = await createLocation(office.dispatcher, { name: 'Stari hotel', kind: 'hotel' })
  await archiveLocation(office.dispatcher, hidden.id)
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: otherVehicle.id })

  const refused = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, hidden.id, '2026-11-02T10:30:00.000Z'))
  expect(refused.status).toBe(409)
  const archivedText = await refused.text()
  expect(archivedText).toContain('location_archived')
  expect(archivedText).not.toContain('ride_overlap')
  const pickup = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where id = $1',
    [moving.transfer.id],
  )
  expect(pickup.rows[0]?.pickup_at.toISOString()).toBe('2026-11-02T14:00:00.000Z')
})

it('a save that changes nothing does not ask about an overlap that is already there', async () => {
  const office = await bookedOffice('htr-ovlp-noop')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112139'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2139AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2139BB'))
  const movingAt = '2026-11-02T10:30:00.000Z'
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, movingAt)
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, {
    rideId: moving.ride.id,
    driverId: driver.id,
    vehicleId: otherVehicle.id,
    confirm: true,
  })
  const before = await correctionAudits(office.created.tenantId)

  const quiet = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, movingAt))
  expect(quiet.status).toBe(200)
  expect(await quiet.json()).toMatchObject({ relocationWarnings: [], workOrders: [] })
  expect(await correctionAudits(office.created.tenantId)).toEqual(before)
})

it('a tight gap warns and a gap equal to the relocation setting does not', async () => {
  const office = await bookedOffice('htr-ovlp-gap')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112140'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2140AA'))
  const otherVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2140BB'))
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: otherVehicle.id })

  const tight = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T11:10:00.000Z'))
  expect(tight.status).toBe(200)
  expect(await tight.json()).toMatchObject({
    relocationWarnings: [{ resource: 'driver', rideId: held.ride.id }],
  })

  const exact = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T11:15:00.000Z', {
    guestName: 'Iva Ivić',
  }))
  expect(exact.status).toBe(200)
  expect(await exact.json()).toMatchObject({ relocationWarnings: [] })
})

it('done, no-show, and cancelled neighbours do not occupy, and an in-progress Ride does', async () => {
  const office = await bookedOffice('htr-ovlp-live')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112141'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2141AA'))
  for (const [state, day] of [['done', '03'], ['no-show', '04'], ['cancelled', '05']] as const) {
    const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, `2026-11-${day}T10:00:00.000Z`)
    const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, `2026-11-${day}T14:00:00.000Z`)
    await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
    await ownerPool.query('update app.rides set state = $2 where id = $1', [held.ride.id, state])
    const movingVehicle = await createVehicle(office.dispatcher, vehicleInput(`ZG2141${state.slice(0, 2).toUpperCase()}`))
    await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: movingVehicle.id })
    const saved = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, `2026-11-${day}T10:30:00.000Z`))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ relocationWarnings: [] })
  }

  const underwayAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const laterAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  const underway = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, underwayAt)
  const later = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, laterAt)
  const underwayVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2141UU'))
  const laterVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2141VV'))
  await assignRide(office.dispatcher, { rideId: underway.ride.id, driverId: driver.id, vehicleId: underwayVehicle.id })
  await assignRide(office.dispatcher, { rideId: later.ride.id, driverId: driver.id, vehicleId: laterVehicle.id })
  const refused = await call('PATCH', `/api/transfers/${later.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, new Date().toISOString()))
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_overlap')
})

it('asks again when a later pickup move overlaps, and another Tenant Ride does not occupy', async () => {
  const office = await bookedOffice('htr-ovlp-again')
  const other = await bookedOffice('htr-ovlp-other')
  const driver = await createDriver(office.dispatcher, driverInput('Drago Driver', '+385911112142'))
  const otherDriver = await createDriver(other.dispatcher, driverInput('Ema Driver', '+385911112143'))
  const vehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2142AA'))
  const movingVehicle = await createVehicle(office.dispatcher, vehicleInput('ZG2142BB'))
  const otherVehicle = await createVehicle(other.dispatcher, vehicleInput('ZG2142CC'))
  const held = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T10:00:00.000Z')
  const moving = await recordRide(office.dispatcher, office.client.id, office.start.id, office.end.id, '2026-11-02T14:00:00.000Z')
  const foreign = await recordRide(other.dispatcher, other.client.id, other.start.id, other.end.id, '2026-11-02T10:15:00.000Z')
  await assignRide(office.dispatcher, { rideId: held.ride.id, driverId: driver.id, vehicleId: vehicle.id })
  await assignRide(office.dispatcher, { rideId: moving.ride.id, driverId: driver.id, vehicleId: movingVehicle.id })
  await assignRide(other.dispatcher, { rideId: foreign.ride.id, driverId: otherDriver.id, vehicleId: otherVehicle.id })

  const confirmed = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, {
    ...correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:30:00.000Z'),
    confirm: true,
  })
  expect(confirmed.status).toBe(200)

  const again = await call('PATCH', `/api/transfers/${moving.transfer.id}`, office.dispatcher, correctionBody(office.client.id, office.start.id, office.end.id, '2026-11-02T10:15:00.000Z'))
  expect(again.status).toBe(409)
  expect(await again.text()).toContain('ride_overlap')
  const pickup = await ownerPool.query<{ pickup_at: Date }>(
    'select pickup_at from app.transfers where id = $1',
    [moving.transfer.id],
  )
  expect(pickup.rows[0]?.pickup_at.toISOString()).toBe('2026-11-02T10:30:00.000Z')

  const seen = await withAppTenant(office.created.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `select r.id from app.rides as r where r.state in ('assigned', 'accepted')`,
    )
    return result.rows.map(row => row.id)
  })
  expect(seen).toContain(held.ride.id)
  expect(seen).not.toContain(foreign.ride.id)
})

it('refuses confirm on the record route and a non-boolean confirm on a correction', async () => {
  const body = correctionBody(
    '9e4b3f6d-5555-4555-8555-555555555555',
    'a1b2c3d4-5555-4555-8555-555555555555',
    'b1b2c3d4-6666-4666-8666-666666666666',
    '2026-11-02T10:00:00.000Z',
  )
  expect((await call('POST', '/api/transfers', undefined, { ...body, confirm: true })).status).toBe(400)
  expect((await call('PATCH', '/api/transfers/9e4b3f6d-5555-4555-8555-555555555555', undefined, { ...body, confirm: 'yes' })).status).toBe(400)
})
