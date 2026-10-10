import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../../shared'
import { createClient } from '../modules/clients'
import { archiveLocation, createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { listTransferDay, readOfficeHome } from '../modules/transfers'
import getTransfers from './transfers.get'
import postTransfer from './transfers.post'

/**
 * GET and POST /api/transfers.
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
const password = 'transfers-http-password'
const guest = 'Ana Anić'
const flight = 'OU 384'
const note = 'Čeka na terminalu'
const tabla = 'GOSPOĐA HORVAT'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers', (event) => {
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
    await owner.query(`delete from app.rides where tenant_id::text in (
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
  expect(await calendarDay.json()).toEqual({ date: sample.calendar, rides: [] })

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
    pickupAt: pickupInsideWindow(),
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
