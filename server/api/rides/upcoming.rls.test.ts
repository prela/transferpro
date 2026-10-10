import type { PaymentMethod, TenantRole } from '../../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, driverUpcomingListSchema, instantFromWallClock } from '../../../shared'
import { createClient } from '../../modules/clients'
import { createDriver, updateDriver } from '../../modules/drivers'
import { archiveLocation, createLocation } from '../../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../../modules/tenancy'
import { assignRide, createTransfer, listTransferDay } from '../../modules/transfers'
import { archiveVehicle, createVehicle } from '../../modules/vehicles'
import getUpcoming from './upcoming.get'

/**
 * GET /api/rides/upcoming.
 * The per-driver filter is application code: RLS only hides another Tenant.
 * These tests sign in and read the route. They do not pass a driver id the
 * server is allowed to trust.
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
const password = 'driver-rides-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/rides/upcoming', (event) => {
  if (event.method === 'GET')
    return getUpcoming(event)
  return new Response('Not Found', { status: 404 })
})
const callUpcoming = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hdrv-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hdrv-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hdrv-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hdrv-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hdrv-%'`)
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

/** The app role, with the session tenant set. This is the RLS proof: no driver filter. */
async function rideIdsForTenant(tenantId: string): Promise<string[]> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await client.query<{ id: string }>('select id from app.rides')
    await client.query('commit')
    return result.rows.map(row => row.id)
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
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

function call(session?: Headers, query = '') {
  return callUpcoming(new Request(`http://localhost/api/rides/upcoming${query}`, {
    method: 'GET',
    headers: session,
  }))
}

async function setRide(rideId: string, patch: { state?: string, pickupAt?: string }) {
  if (patch.state)
    await ownerPool.query('update app.rides set state = $2 where id = $1', [rideId, patch.state])
  if (patch.pickupAt)
    await ownerPool.query('update app.transfers set pickup_at = $2 where id = (select transfer_id from app.rides where id = $1)', [rideId, patch.pickupAt])
}

const driverFields = {
  kind: 'own' as const,
  drivingLicenceExpiresOn: '2030-01-01',
  transportLicenceExpiresOn: '2030-06-01',
}

it('no session is 401 and the office is 403', async () => {
  const created = await tenant('hdrv-auth')
  await addMember(created.tenantId, 'hdrv-auth-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const admin = await signIn('hdrv-auth-admin@example.test')
  const dispatcher = await signIn('hdrv-auth-dispatcher@example.test')

  expect((await call()).status).toBe(401)
  expect((await call(admin)).status).toBe(403)
  expect((await call(dispatcher)).status).toBe(403)
})

it('returns only this Driver\'s assigned and accepted Rides, and hides card and invoice fares', async () => {
  const created = await tenant('hdrv-own')
  const driverUserId = await addMember(created.tenantId, 'hdrv-own-driver@example.test', 'Marko Vozač', 'driver')
  await addMember(created.tenantId, 'hdrv-own-unlinked@example.test', 'Nema Vozaca', 'driver')
  const admin = await signIn('hdrv-own-admin@example.test')
  const driver = await signIn('hdrv-own-driver@example.test')
  const unlinked = await signIn('hdrv-own-unlinked@example.test')
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  // No address on the start. The end keeps its address after it is archived.
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Park', kind: 'hotel', address: 'Masarykov put 1' })
  // An external Driver sees the agency name. The kind is not rewritten.
  const mine = await createDriver(admin, {
    ...driverFields,
    kind: 'external',
    name: 'Marko Vozač',
    phone: '+385911110201',
    memberUserId: driverUserId,
  })
  const other = await createDriver(admin, {
    ...driverFields,
    name: 'Iva Druga',
    phone: '+385911110202',
  })
  const vehicle = await createVehicle(admin, {
    registrationPlate: 'DU200AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })

  // One Zagreb day, midday, so the three office rows cannot fall on two dates.
  const day = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 1)
  const at = (wall: string) => instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString()
  async function ride(input: {
    guest: string
    pickupAt: string
    price: number
    payment: PaymentMethod
    airportMark: boolean
    flightNumber?: string
    passengerCount: number
    luggageCount?: number
    childSeatCount?: number
    note?: string | null
    tabla?: string
    assign?: string
    state?: string
    movePickupTo?: string
  }) {
    const recorded = await createTransfer(admin, {
      clientId: client.id,
      pickupAt: input.pickupAt,
      startLocationId: start.id,
      endLocationId: end.id,
      passengerCount: input.passengerCount,
      guestName: input.guest,
      flightNumber: input.flightNumber ?? null,
      price: input.price,
      payment: input.payment,
      airportMark: input.airportMark,
      luggageCount: input.luggageCount ?? 0,
      childSeatCount: input.childSeatCount ?? 0,
      note: input.note ?? null,
      tabla: input.tabla ?? '',
    })
    if (input.assign) {
      await assignRide(admin, { rideId: recorded.ride.id, driverId: input.assign, vehicleId: vehicle.id })
      if (input.state || input.movePickupTo)
        await setRide(recorded.ride.id, { state: input.state, pickupAt: input.movePickupTo })
    }
    return recorded
  }

  // `accepted` stores the copied flag as true. This Driver's default is false, so turn it on for these Rides only.
  await updateDriver(admin, mine.id, { mustAccept: true })
  await ride({
    guest: 'Iva Card',
    pickupAt: at('10:00'),
    price: 99,
    payment: 'card',
    airportMark: false,
    passengerCount: 1,
    luggageCount: 0,
    childSeatCount: 0,
    note: 'Voucher fare 99.00',
    tabla: 'GOSPOĐA HORVAT',
    assign: mine.id,
    state: 'accepted',
  })
  await ride({ guest: 'Iva Waiting', pickupAt: at('10:30'), price: 21, payment: 'cash', airportMark: false, passengerCount: 1, assign: mine.id })
  await updateDriver(admin, mine.id, { mustAccept: false })
  const cashRide = await ride({
    guest: 'Iva Cash',
    pickupAt: at('11:00'),
    price: 42.5,
    payment: 'cash',
    airportMark: true,
    flightNumber: 'OU 384',
    passengerCount: 3,
    luggageCount: 2,
    childSeatCount: 1,
    assign: mine.id,
  })
  await ride({ guest: 'Iva Invoice', pickupAt: at('12:00'), price: 80, payment: 'invoice_to_agency', airportMark: false, passengerCount: 2, assign: mine.id })
  await ride({ guest: 'Iva Other', pickupAt: at('13:00'), price: 15, payment: 'cash', airportMark: false, passengerCount: 1, assign: other.id })
  await ride({ guest: 'Iva Done', pickupAt: at('14:00'), price: 11, payment: 'cash', airportMark: false, passengerCount: 1, assign: mine.id, state: 'done' })
  await ride({ guest: 'Iva Noshow', pickupAt: at('15:00'), price: 12, payment: 'cash', airportMark: false, passengerCount: 1, assign: mine.id, state: 'no-show' })
  await ride({ guest: 'Iva Cancel', pickupAt: at('16:00'), price: 13, payment: 'cash', airportMark: false, passengerCount: 1, assign: mine.id, state: 'cancelled' })
  await ride({ guest: 'Iva Open', pickupAt: at('17:00'), price: 14, payment: 'cash', airportMark: false, passengerCount: 1 })
  await ride({ guest: 'Iva Past', pickupAt: at('18:00'), price: 16, payment: 'cash', airportMark: false, passengerCount: 1, assign: mine.id, movePickupTo: '2020-01-15T10:00:00.000Z' })
  await ride({ guest: 'Iva Later', pickupAt: at('19:00'), price: 17, payment: 'card', airportMark: false, passengerCount: 1, assign: mine.id, movePickupTo: '2035-06-01T10:00:00.000Z' })

  // An archived place still has a name. The driver cannot open the place list.
  await archiveLocation(admin, end.id)
  await archiveVehicle(admin, vehicle.id)

  const office = await listTransferDay(admin, day)
  expect(office.rides.find(row => row.guestName === 'Iva Cash')).toMatchObject({ price: '42.50', payment: 'cash' })
  expect(office.rides.find(row => row.guestName === 'Iva Card')).toMatchObject({ price: '99.00', payment: 'card' })
  expect(office.rides.find(row => row.guestName === 'Iva Invoice')).toMatchObject({ price: '80.00', payment: 'invoice_to_agency' })

  const empty = driverUpcomingListSchema.parse(await (await call(unlinked)).json())
  expect(empty.rides).toEqual([])

  const response = await call(driver, `?driverId=${other.id}`)
  expect(response.status).toBe(200)
  const listed = driverUpcomingListSchema.parse(await response.json())
  expect(listed.rides.map(row => row.guestName)).toEqual([
    'Iva Past',
    'Iva Card',
    'Iva Waiting',
    'Iva Cash',
    'Iva Invoice',
    'Iva Later',
  ])
  expect(listed.rides.map(row => ({ state: row.state, mustAccept: row.mustAccept }))).toEqual([
    { state: 'assigned', mustAccept: false },
    { state: 'accepted', mustAccept: true },
    { state: 'assigned', mustAccept: true },
    { state: 'assigned', mustAccept: false },
    { state: 'assigned', mustAccept: false },
    { state: 'assigned', mustAccept: false },
  ])
  expect(listed.rides.map(row => row.guestName)).not.toContain('Iva Other')
  expect(listed.rides.map(row => row.guestName)).not.toContain('Iva Done')
  expect(listed.rides.map(row => row.guestName)).not.toContain('Iva Noshow')
  expect(listed.rides.map(row => row.guestName)).not.toContain('Iva Cancel')
  expect(listed.rides.map(row => row.guestName)).not.toContain('Iva Open')

  const cash = listed.rides.find(row => row.guestName === 'Iva Cash')
  expect(cash).toMatchObject({
    from: 'Zračna luka Dubrovnik',
    to: 'Hotel Park',
    fromAddress: null,
    toAddress: 'Masarykov put 1',
    passengerCount: 3,
    flightNumber: 'OU 384',
    airportMark: true,
    clientName: 'Agencija Mora',
    clientKind: 'agency',
    luggageCount: 2,
    childSeatCount: 1,
    note: null,
    tabla: null,
    registrationPlate: 'DU200AA',
    price: '42.50',
    payment: 'cash',
    state: 'assigned',
    mustAccept: false,
  })
  const waiting = listed.rides.find(row => row.guestName === 'Iva Waiting')
  expect(waiting).toMatchObject({
    state: 'assigned',
    mustAccept: true,
    price: '21.00',
    payment: 'cash',
  })
  const card = listed.rides.find(row => row.guestName === 'Iva Card')
  expect(card).toMatchObject({
    price: null,
    payment: null,
    flightNumber: null,
    airportMark: false,
    clientName: 'Agencija Mora',
    clientKind: 'agency',
    fromAddress: null,
    toAddress: 'Masarykov put 1',
    luggageCount: 0,
    childSeatCount: 0,
    note: 'Voucher fare 99.00',
    tabla: 'GOSPOĐA HORVAT',
    registrationPlate: 'DU200AA',
  })
  expect(card?.tabla).not.toBe(card?.guestName)
  expect(JSON.stringify(card)).not.toContain('"card"')
  expect(JSON.stringify(card)).not.toContain('"price":"99.00"')
  expect(JSON.stringify(listed)).not.toContain('archived')
  const invoiced = listed.rides.find(row => row.guestName === 'Iva Invoice')
  expect(invoiced).toMatchObject({ price: null, payment: null })
  expect(JSON.stringify(invoiced)).not.toContain('80.00')
  expect(JSON.stringify(invoiced)).not.toContain('invoice')
  const later = listed.rides.find(row => row.guestName === 'Iva Later')
  expect(later).toMatchObject({ price: null, payment: null, pickupAt: '2035-06-01T10:00:00.000Z' })
  expect(listed.rides.find(row => row.guestName === 'Iva Past')?.pickupAt).toBe('2020-01-15T10:00:00.000Z')

  const foreignTenant = await tenant('hdrv-other')
  const foreignAdmin = await signIn('hdrv-other-admin@example.test')
  const foreignClient = await createClient(foreignAdmin, { name: 'Agencija Druga', kind: 'agency' })
  const foreignStart = await createLocation(foreignAdmin, { name: 'Start Druga', kind: 'address' })
  const foreignEnd = await createLocation(foreignAdmin, { name: 'End Druga', kind: 'hotel' })
  const foreignDriver = await createDriver(foreignAdmin, {
    ...driverFields,
    name: 'Petar Strani',
    phone: '+385911110203',
  })
  const foreignVehicle = await createVehicle(foreignAdmin, {
    registrationPlate: 'DU201AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const foreignRide = await createTransfer(foreignAdmin, {
    clientId: foreignClient.id,
    pickupAt: at('10:00'),
    startLocationId: foreignStart.id,
    endLocationId: foreignEnd.id,
    passengerCount: 1,
    guestName: 'Iva Foreign',
    price: 55,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  await assignRide(foreignAdmin, { rideId: foreignRide.ride.id, driverId: foreignDriver.id, vehicleId: foreignVehicle.id })

  const again = driverUpcomingListSchema.parse(await (await call(driver, `?driverId=${foreignDriver.id}`)).json())
  expect(again.rides.map(row => row.guestName)).not.toContain('Iva Foreign')
  expect(again.rides.map(row => row.guestName)).toContain('Iva Cash')

  // No driver predicate. Tenant A's session must not see Tenant B's Ride, and the reverse.
  const ownIds = await rideIdsForTenant(created.tenantId)
  const foreignIds = await rideIdsForTenant(foreignTenant.tenantId)
  expect(ownIds).toContain(cashRide.ride.id)
  expect(ownIds).not.toContain(foreignRide.ride.id)
  expect(foreignIds).toContain(foreignRide.ride.id)
  expect(foreignIds).not.toContain(cashRide.ride.id)
})
