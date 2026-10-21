import type { RideState, TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { instantFromWallClock, RIDE_HISTORY_PAGE_SIZE, RIDE_STATES, rideHistorySchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { createVehicle } from '../modules/vehicles'
import getRideHistory from './clients/[id]/ride-history.get'

/**
 * GET /api/clients/:id/ride-history. One Client's Rides, every state, newest
 * pickup first, 50 per page, with counts over the whole history. Admin and
 * dispatcher may read it. A driver is 403. No session is 401. An unknown
 * Client, and another Tenant's Client, are 404. The pickup wall is the
 * Tenant time zone. ADR-0049.
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
const password = 'ride-history-http-password'
const zone = 'Europe/Zagreb'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const missingId = '9e4b3f6d-5555-4555-8555-555555555555'
const pageSize = 50

const app = createApp()
app.use('/api/clients', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '').replace(/\/$/, '')
  const rest = pathOnly === '/' ? '' : decodeURIComponent(pathOnly.replace(/^\//, ''))
  const parts = rest.split('/').filter(part => part !== '')
  const id = parts[0] ?? ''
  if (parts[1] === 'ride-history' && parts.length === 2 && event.method === 'GET') {
    event.context.params = { id }
    return getRideHistory(event)
  }
  throw new Error(`unmapped ${event.method} ${event.path}`)
})
const callHistory = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'crh-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'crh-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'crh-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'crh-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'crh-%'`)
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

async function addMember(tenantId: string, email: string, name: string, role: TenantRole): Promise<void> {
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

function call(path: string, session?: Headers) {
  return callHistory(new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: session,
  }))
}

interface SeedRide {
  tenantId: string
  clientId: string
  startId: string
  endId: string
  pickupAt: string
  guestName: string
  price?: string
  payment?: string
  rideId?: string
  state?: RideState
  driverId?: string | null
  vehicleId?: string | null
  mustAccept?: boolean | null
  partnerId?: string | null
}

function historyState(index: number): RideState {
  if (index % 5 === 0)
    return 'done'
  if (index % 5 === 1)
    return 'no-show'
  if (index % 5 === 2)
    return 'cancelled'
  return 'unassigned'
}

async function seedRide(seed: SeedRide): Promise<string> {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.transfers (
      tenant_id, client_id, pickup_at, start_location_id, end_location_id,
      passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count,
      external_id
    ) values ($1, $2, $3, $4, $5, 1, $6, $7, $8, false, 0, 0, gen_random_uuid()::text)
    returning id`,
    [
      seed.tenantId,
      seed.clientId,
      seed.pickupAt,
      seed.startId,
      seed.endId,
      seed.guestName,
      seed.price ?? '10.00',
      seed.payment ?? 'cash',
    ],
  )
  const transferId = inserted.rows[0]?.id
  if (transferId === undefined)
    throw new Error('transfer insert returned no row')
  const ride = await ownerPool.query<{ id: string }>(
    `insert into app.rides (id, tenant_id, transfer_id, state, driver_id, vehicle_id, must_accept, partner_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      seed.rideId ?? null,
      seed.tenantId,
      transferId,
      seed.state ?? 'unassigned',
      seed.driverId ?? null,
      seed.vehicleId ?? null,
      seed.mustAccept ?? null,
      seed.partnerId ?? null,
    ],
  )
  const rideId = ride.rows[0]?.id
  if (rideId === undefined)
    throw new Error('ride insert returned no row')
  return rideId
}

it('a bad client id and a bad cursor are 400, and no session is 401', async () => {
  expect(RIDE_HISTORY_PAGE_SIZE).toBe(pageSize)
  expect((await call(`/api/clients/not-a-uuid/ride-history`)).status).toBe(400)
  expect((await call(`/api/clients/${missingId}/ride-history`)).status).toBe(401)
  await tenant('crh-cursor-bad', 'Hana Admin')
  const admin = await signIn('crh-cursor-bad-admin@example.test')
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  expect((await call(`/api/clients/${client.id}/ride-history?cursor=%%%`, admin)).status).toBe(400)
})

it('a driver is 403, an unknown or another Tenant client is 404, and an empty history is zeros', async () => {
  const created = await tenant('crh-access', 'Hana Admin')
  await addMember(created.tenantId, 'crh-access-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'crh-access-driver@example.test', 'Drago Driver', 'driver')
  await tenant('crh-access-b', 'Iva Admin')
  const admin = await signIn('crh-access-admin@example.test')
  const dispatcher = await signIn('crh-access-dispatcher@example.test')
  const driver = await signIn('crh-access-driver@example.test')
  const otherAdmin = await signIn('crh-access-b-admin@example.test')
  const client = await createClient(admin, { name: 'Hotel Park', kind: 'hotel' })
  const hidden = await createClient(otherAdmin, { name: 'Hotel Skriven', kind: 'hotel' })
  const guest = 'Gost koji se ne smije vidjeti'

  expect((await call(`/api/clients/${client.id}/ride-history`, driver)).status).toBe(403)
  expect(await (await call(`/api/clients/${client.id}/ride-history`, driver)).text()).not.toContain(guest)
  expect((await call(`/api/clients/${missingId}/ride-history`, admin)).status).toBe(404)
  expect((await call(`/api/clients/${hidden.id}/ride-history`, admin)).status).toBe(404)
  expect((await call(`/api/clients/${client.id}/ride-history`, driver)).status).toBe(403)

  const empty = rideHistorySchema.parse(await (await call(`/api/clients/${client.id}/ride-history`, dispatcher)).json())
  expect(empty).toEqual({
    rides: [],
    nextCursor: null,
    counts: { total: 0, done: 0, noShow: 0, cancelled: 0 },
  })
})

it('lists every state newest first, in the Tenant time zone, with whole-history counts', async () => {
  const created = await tenant('crh-rows', 'Hana Admin')
  await addMember(created.tenantId, 'crh-rows-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const admin = await signIn('crh-rows-admin@example.test')
  const dispatcher = await signIn('crh-rows-dispatcher@example.test')
  const client = await createClient(dispatcher, { name: 'Agencija Jadran', kind: 'agency' })
  const otherClient = await createClient(dispatcher, { name: 'Drugi naručitelj', kind: 'individual' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(dispatcher, {
    name: 'Ivo Vozač',
    kind: 'own',
    phone: '+385911114170',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: 'DU417RH',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const other = await tenant('crh-rows-b', 'Iva Admin')
  const otherAdmin = await signIn('crh-rows-b-admin@example.test')
  const otherClientRow = await createClient(otherAdmin, { name: 'Tuđa agencija', kind: 'agency' })
  const otherStart = await createLocation(otherAdmin, { name: 'Tuđi početak', kind: 'other' })
  const otherEnd = await createLocation(otherAdmin, { name: 'Tuđi kraj', kind: 'other' })

  // 03:00 local is before the operational-day start, so the day is the previous date.
  const earlyWall = '2026-01-15T03:00'
  const earlyPickup = instantFromWallClock(earlyWall, zone).toISOString()
  const noon = instantFromWallClock('2026-06-02T12:00', zone).toISOString()
  const later = instantFromWallClock('2026-06-03T09:15', zone).toISOString()
  const same = instantFromWallClock('2026-06-04T18:00', zone).toISOString()
  const lowId = '11111111-1111-4111-8111-111111111111'
  const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

  const places = { tenantId: created.tenantId, clientId: client.id, startId: start.id, endId: end.id }
  await seedRide({ ...places, pickupAt: earlyPickup, guestName: 'Rani gost', state: 'unassigned' })
  await seedRide({
    ...places,
    pickupAt: noon,
    guestName: 'Dodijeljeni gost',
    state: 'assigned',
    driverId: driver.id,
    vehicleId: vehicle.id,
    mustAccept: false,
    price: '12.50',
    payment: 'card',
  })
  await seedRide({
    ...places,
    pickupAt: later,
    guestName: 'Prihvaćeni gost',
    state: 'accepted',
    driverId: driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  await seedRide({ ...places, pickupAt: instantFromWallClock('2026-06-01T08:00', zone).toISOString(), guestName: 'Završeni gost', state: 'done' })
  await seedRide({ ...places, pickupAt: instantFromWallClock('2026-05-20T16:40', zone).toISOString(), guestName: 'Nedolazak', state: 'no-show' })
  const partner = await ownerPool.query<{ id: string }>(
    `insert into app.partners (tenant_id, name) values ($1, 'Mora Transfer') returning id`,
    [created.tenantId],
  )
  const partnerId = partner.rows[0]?.id
  if (partnerId === undefined)
    throw new Error('partner insert returned no row')
  await seedRide({
    ...places,
    pickupAt: instantFromWallClock('2026-05-01T12:00', zone).toISOString(),
    guestName: 'Predani gost',
    state: 'handed_off',
    partnerId,
  })
  await seedRide({ ...places, pickupAt: instantFromWallClock('2026-04-01T11:00', zone).toISOString(), guestName: 'Otkazani gost', state: 'cancelled', price: '0.00', payment: 'invoice_to_agency' })
  await seedRide({ ...places, pickupAt: same, guestName: 'Stariji isti sat', rideId: lowId, state: 'done' })
  await seedRide({ ...places, pickupAt: same, guestName: 'Noviji isti sat', rideId: highId, state: 'cancelled' })
  await seedRide({
    tenantId: created.tenantId,
    clientId: otherClient.id,
    startId: start.id,
    endId: end.id,
    pickupAt: later,
    guestName: 'Tuđi gost ovog Tenanta',
  })
  await seedRide({
    tenantId: other.tenantId,
    clientId: otherClientRow.id,
    startId: otherStart.id,
    endId: otherEnd.id,
    pickupAt: later,
    guestName: 'Gost drugog Tenanta',
    state: 'done',
  })

  const body = rideHistorySchema.parse(await (await call(`/api/clients/${client.id}/ride-history`, admin)).json())
  const again = rideHistorySchema.parse(await (await call(`/api/clients/${client.id}/ride-history`, dispatcher)).json())
  expect(again.counts).toEqual(body.counts)
  expect(body.counts).toEqual({ total: 9, done: 2, noShow: 1, cancelled: 2 })
  expect(body.nextCursor).toBeNull()
  expect(body.rides.map(ride => ride.guestName)).toEqual([
    'Noviji isti sat',
    'Stariji isti sat',
    'Prihvaćeni gost',
    'Dodijeljeni gost',
    'Završeni gost',
    'Nedolazak',
    'Predani gost',
    'Otkazani gost',
    'Rani gost',
  ])
  expect(new Set(body.rides.map(ride => ride.state))).toEqual(new Set(RIDE_STATES))
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Tuđi gost ovog Tenanta')
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Gost drugog Tenanta')

  const early = body.rides.find(ride => ride.guestName === 'Rani gost')
  expect(early).toMatchObject({
    pickupWall: earlyWall,
    operationalDay: '2026-01-14',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    state: 'unassigned',
    driverName: null,
    partnerName: null,
    price: '10.00',
    payment: 'cash',
  })
  expect(early?.pickupAt).toBe(earlyPickup)
  expect(body.rides.find(ride => ride.guestName === 'Dodijeljeni gost')).toMatchObject({
    driverName: 'Ivo Vozač',
    partnerName: null,
    price: '12.50',
    payment: 'card',
    state: 'assigned',
  })
  expect(body.rides.find(ride => ride.guestName === 'Prihvaćeni gost')?.driverName).toBe('Ivo Vozač')
  expect(body.rides.find(ride => ride.state === 'cancelled' && ride.guestName === 'Otkazani gost')).toMatchObject({
    price: '0.00',
    payment: 'invoice_to_agency',
    driverName: null,
  })
  expect(body.rides.find(ride => ride.guestName === 'Predani gost')).toMatchObject({
    state: 'handed_off',
    driverName: null,
    partnerName: 'Mora Transfer',
  })
  expect(body.rides.filter(ride => ride.state !== 'handed_off').every(ride => ride.partnerName === null)).toBe(true)
})

it('pages 50 rides and keeps the counts on the whole history', async () => {
  const created = await tenant('crh-page', 'Hana Admin')
  const admin = await signIn('crh-page-admin@example.test')
  const client = await createClient(admin, { name: 'Duga agencija', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Polazak', kind: 'address' })
  const end = await createLocation(admin, { name: 'Dolazak', kind: 'address' })
  const base = instantFromWallClock('2026-03-01T10:00', zone).getTime()
  const seeded: { guestName: string, pickupAt: string }[] = []
  for (let index = 0; index <= pageSize; index += 1) {
    const guestName = `n${String(index).padStart(2, '0')}`
    const pickupAt = new Date(base + index * 60_000).toISOString()
    await seedRide({
      tenantId: created.tenantId,
      clientId: client.id,
      startId: start.id,
      endId: end.id,
      pickupAt,
      guestName,
      state: historyState(index),
    })
    seeded.push({ guestName, pickupAt })
  }
  const newestFirst = [...seeded].sort((left, right) => right.pickupAt.localeCompare(left.pickupAt))

  const first = rideHistorySchema.parse(await (await call(`/api/clients/${client.id}/ride-history`, admin)).json())
  expect(first.rides).toHaveLength(pageSize)
  expect(first.rides.map(ride => ride.guestName)).toEqual(newestFirst.slice(0, pageSize).map(ride => ride.guestName))
  expect(first.nextCursor).toEqual(expect.any(String))
  expect(first.counts.total).toBe(pageSize + 1)
  // 0, 5, 10, ..., 50 → 11 done. 1, 6, ..., 46 → 10 no-show. 2, 7, ..., 47 → 10 cancelled.
  expect(first.counts).toEqual({ total: 51, done: 11, noShow: 10, cancelled: 10 })

  const second = rideHistorySchema.parse(await (await call(
    `/api/clients/${client.id}/ride-history?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    admin,
  )).json())
  expect(second.rides.map(ride => ride.guestName)).toEqual(['n00'])
  expect(second.nextCursor).toBeNull()
  expect(second.counts).toEqual(first.counts)
})
