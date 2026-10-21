import type { PaymentMethod, TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { instantFromWallClock, RIDE_HISTORY_PAGE_SIZE, rideHistorySchema, transferDaySchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { archivePartner, createPartner } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { assignRide, createTransfer } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import getPartnerRideHistory from './partners/[id]/ride-history.get'
import postCancel from './rides/[id]/cancel.post'
import postDone from './rides/[id]/done.post'
import postHandOff from './rides/[id]/hand-off.post'
import postNoShow from './rides/[id]/no-show.post'
import postPartner from './rides/[id]/partner.post'
import postTakeBack from './rides/[id]/take-back.post'
import getUpcoming from './rides/upcoming.get'
import getTransfers from './transfers.get'

/**
 * GET /api/partners/:id/ride-history, and the Partner phone and email on the
 * office day read. Open and closed Rides handed to that Partner, newest
 * pickup first, the same page and counts as a Client's history. A driver
 * is 403. An unknown or other-Tenant Partner is 404. An archived Partner
 * still answers. The Driver's reads carry no Partner contact. ADR-0049.
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
const password = 'partner-history-http-password'
const zone = 'Europe/Zagreb'
const phone = '+385911114150'
const email = 'mora415@example.test'
const note = 'Napomena koja ne smije na vožnju 415.'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')
const missingId = '9e4b3f6d-5555-4555-8555-555555555555'
const pageSize = 50

const app = createApp()
app.use('/api/partners', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '').replace(/\/$/, '')
  const marker = '/api/partners/'
  const rest = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
  const parts = rest.split('/').filter(part => part !== '')
  const id = parts[0] ?? ''
  if (parts[1] === 'ride-history' && parts.length === 2 && event.method === 'GET') {
    event.context.params = { id }
    return getPartnerRideHistory(event)
  }
  return new Response('Not Found', { status: 404 })
})
app.use('/api/rides', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  const marker = '/api/rides/'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
  if (relative === 'upcoming' && event.method === 'GET')
    return getUpcoming(event)
  const [id, action] = relative.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'hand-off' && event.method === 'POST')
    return postHandOff(event)
  if (action === 'partner' && event.method === 'POST')
    return postPartner(event)
  if (action === 'take-back' && event.method === 'POST')
    return postTakeBack(event)
  if (action === 'done' && event.method === 'POST')
    return postDone(event)
  if (action === 'no-show' && event.method === 'POST')
    return postNoShow(event)
  if (action === 'cancel' && event.method === 'POST')
    return postCancel(event)
  return new Response('Not Found', { status: 404 })
})
app.use('/api/transfers', (event) => {
  if (event.method === 'GET')
    return getTransfers(event)
  return new Response('Not Found', { status: 404 })
})
const callHttp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'prh-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'prh-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'prh-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'prh-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'prh-%'`)
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

async function addMember(tenantId: string, memberEmail: string, name: string, role: TenantRole): Promise<string> {
  const userId = crypto.randomUUID()
  await authPool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, name, memberEmail],
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

async function signIn(memberEmail: string): Promise<Headers> {
  const response = await handleAuthRequest(new Request(new URL('/api/auth/sign-in/email', authUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: memberEmail, password }),
  }))
  if (!response.ok)
    throw new Error(`sign-in status ${response.status}`)
  return new Headers({ cookie: response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ') })
}

function call(method: string, path: string, session?: Headers, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callHttp(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

function at(wall: string): string {
  return instantFromWallClock(wall, zone).toISOString()
}

interface OfficeWorld {
  tenantId: string
  dispatcher: Headers
  admin: Headers
  client: { id: string }
  start: { id: string }
  end: { id: string }
}

async function office(slug: string): Promise<OfficeWorld> {
  const created = await tenant(slug)
  await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const admin = await signIn(`${slug}-admin@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Jadran', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Excelsior', kind: 'hotel' })
  return { tenantId: created.tenantId, dispatcher, admin, client, start, end }
}

async function recordRide(session: Headers, world: OfficeWorld, guestName: string, wall: string, price = 10, payment: PaymentMethod = 'cash') {
  const recorded = await createTransfer(session, {
    externalId: crypto.randomUUID(),
    clientId: world.client.id,
    pickupAt: at(wall),
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName,
    price,
    payment,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  return recorded.ride.id
}

async function expectOk(response: Response): Promise<void> {
  if (response.status === 200)
    return
  expect(response.status, await response.text()).toBe(200)
}

it('a bad partner id and a bad cursor are 400, and no session is 401', async () => {
  expect(RIDE_HISTORY_PAGE_SIZE).toBe(pageSize)
  expect((await call('GET', '/api/partners/not-a-uuid/ride-history')).status).toBe(400)
  expect((await call('GET', `/api/partners/${missingId}/ride-history`)).status).toBe(401)
  const world = await office('prh-cursor')
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer', phone, email, note })
  expect((await call('GET', `/api/partners/${partner.id}/ride-history?cursor=%%%`, world.admin)).status).toBe(400)
  expect((await call('GET', `/api/partners/${partner.id}/ride-history?extra=1`, world.admin)).status).toBe(400)
})

it('a driver is 403, an unknown or another Tenant partner is 404, and an empty history is zeros', async () => {
  const world = await office('prh-access')
  await addMember(world.tenantId, 'prh-access-driver@example.test', 'Drago Driver', 'driver')
  const driver = await signIn('prh-access-driver@example.test')
  const other = await office('prh-access-b')
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer', phone, email, note })
  const hidden = await createPartner(other.dispatcher, { name: 'Tuđi podizvođač', phone: null, email: null, note: null })
  const guest = 'Gost koji se ne smije vidjeti'
  await handOff(world.dispatcher, await recordRide(world.dispatcher, world, guest, '2026-10-22T12:00'), partner.id)

  const refused = await call('GET', `/api/partners/${partner.id}/ride-history`, driver)
  expect(refused.status).toBe(403)
  const refusedText = await refused.text()
  expect(refusedText).not.toContain(guest)
  expect(refusedText).not.toContain(phone)
  expect(refusedText).not.toContain(email)
  expect((await call('GET', `/api/partners/${missingId}/ride-history`, world.admin)).status).toBe(404)
  expect((await call('GET', `/api/partners/${hidden.id}/ride-history`, world.admin)).status).toBe(404)

  const emptyPartner = await createPartner(world.admin, { name: 'Prazan', phone: null, email: null, note: null })
  const empty = rideHistorySchema.parse(await (await call('GET', `/api/partners/${emptyPartner.id}/ride-history`, world.dispatcher)).json())
  expect(empty).toEqual({
    rides: [],
    nextCursor: null,
    counts: { total: 0, done: 0, noShow: 0, cancelled: 0 },
  })
})

it('lists open and closed Rides newest first, keeps an archived Partner, and counts the whole history', async () => {
  const world = await office('prh-rows')
  const secondClient = await createClient(world.dispatcher, { name: 'Drugi naručitelj', kind: 'individual' })
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer', phone, email, note })
  const otherPartner = await createPartner(world.dispatcher, { name: 'Drugi Podizvođač', phone: null, email: null, note: null })
  const driver = await createDriver(world.dispatcher, {
    name: 'Ivo Vozač',
    kind: 'own',
    phone: '+385911114151',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'DU415RH',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const other = await office('prh-rows-b')
  const foreignPartner = await createPartner(other.dispatcher, { name: 'Tuđi podizvođač', phone: null, email: null, note: null })

  const openOtherClient = await createTransfer(world.dispatcher, {
    externalId: crypto.randomUUID(),
    clientId: secondClient.id,
    pickupAt: at('2026-10-23T15:00'),
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName: 'Gost drugog naručitelja',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  await handOff(world.dispatcher, openOtherClient.ride.id, partner.id)
  await handOff(world.dispatcher, await recordRide(world.dispatcher, world, 'Predani gost', '2026-10-23T09:00'), partner.id)
  const doneId = await recordRide(world.dispatcher, world, 'Završeni gost', '2026-10-22T09:00', 12.5, 'card')
  await handOff(world.dispatcher, doneId, partner.id)
  await expectOk(await call('POST', `/api/rides/${doneId}/done`, world.admin, {}))
  const noShowId = await recordRide(world.dispatcher, world, 'Nedolazak', '2026-10-21T09:00')
  await handOff(world.dispatcher, noShowId, partner.id)
  await expectOk(await call('POST', `/api/rides/${noShowId}/no-show`, world.dispatcher, {}))
  const cancelledId = await recordRide(world.dispatcher, world, 'Otkazani gost', '2026-10-20T09:00', 0, 'invoice_to_agency')
  await handOff(world.dispatcher, cancelledId, partner.id)
  await expectOk(await call('POST', `/api/rides/${cancelledId}/cancel`, world.admin, {}))

  const returnedId = await recordRide(world.dispatcher, world, 'Vraćeni gost', '2026-10-19T09:00')
  await handOff(world.dispatcher, returnedId, partner.id)
  await expectOk(await call('POST', `/api/rides/${returnedId}/take-back`, world.dispatcher, { version: 1 }))

  const movedId = await recordRide(world.dispatcher, world, 'Prebačeni gost', '2026-10-24T09:00')
  await handOff(world.dispatcher, movedId, partner.id)
  await expectOk(await call('POST', `/api/rides/${movedId}/partner`, world.dispatcher, { partnerId: otherPartner.id, version: 1 }))

  const ownId = await recordRide(world.dispatcher, world, 'Vlastiti gost', '2026-10-25T09:00')
  await assignRide(world.dispatcher, { rideId: ownId, driverId: driver.id, vehicleId: vehicle.id, version: 0 })
  await expectOk(await call('POST', `/api/rides/${ownId}/done`, world.admin, {}))

  const foreignId = await recordRide(other.dispatcher, other, 'Gost drugog Tenanta', '2026-10-23T09:00')
  await handOff(other.dispatcher, foreignId, foreignPartner.id)

  await archivePartner(world.admin, partner.id)

  const body = rideHistorySchema.parse(await (await call('GET', `/api/partners/${partner.id}/ride-history`, world.admin)).json())
  const again = rideHistorySchema.parse(await (await call('GET', `/api/partners/${partner.id}/ride-history`, world.dispatcher)).json())
  expect(again.counts).toEqual(body.counts)
  expect(body.counts).toEqual({ total: 5, done: 1, noShow: 1, cancelled: 1 })
  expect(body.nextCursor).toBeNull()
  expect(body.rides.map(ride => ride.guestName)).toEqual([
    'Gost drugog naručitelja',
    'Predani gost',
    'Završeni gost',
    'Nedolazak',
    'Otkazani gost',
  ])
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Vraćeni gost')
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Prebačeni gost')
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Vlastiti gost')
  expect(body.rides.map(ride => ride.guestName)).not.toContain('Gost drugog Tenanta')
  expect(JSON.stringify(body)).not.toContain(phone)
  expect(JSON.stringify(body)).not.toContain(email)
  expect(JSON.stringify(body)).not.toContain(note)

  const open = body.rides.find(ride => ride.guestName === 'Predani gost')
  expect(open).toMatchObject({
    pickupWall: '2026-10-23T09:00',
    operationalDay: '2026-10-23',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    state: 'handed_off',
    driverName: null,
    partnerName: 'Mora Transfer',
    price: '10.00',
    payment: 'cash',
  })
  expect(body.rides.find(ride => ride.guestName === 'Završeni gost')).toMatchObject({
    state: 'done',
    driverName: null,
    partnerName: 'Mora Transfer',
    price: '12.50',
    payment: 'card',
  })
  expect(body.rides.find(ride => ride.guestName === 'Nedolazak')).toMatchObject({
    state: 'no-show',
    partnerName: 'Mora Transfer',
    driverName: null,
  })
  expect(body.rides.find(ride => ride.guestName === 'Otkazani gost')).toMatchObject({
    state: 'cancelled',
    price: '0.00',
    payment: 'invoice_to_agency',
    partnerName: 'Mora Transfer',
    driverName: null,
  })

  const moved = rideHistorySchema.parse(await (await call('GET', `/api/partners/${otherPartner.id}/ride-history`, world.dispatcher)).json())
  expect(moved.rides.map(ride => ride.guestName)).toEqual(['Prebačeni gost'])
  expect(moved.counts).toEqual({ total: 1, done: 0, noShow: 0, cancelled: 0 })
  expect(moved.rides[0]).toMatchObject({ state: 'handed_off', partnerName: 'Drugi Podizvođač', driverName: null })
})

it('pages 50 rides and counts a closed Ride that is not on the page', async () => {
  const world = await office('prh-page')
  const partner = await createPartner(world.admin, { name: 'Dugi podizvođač', phone: null, email: null, note: null })
  const doneId = await recordRide(world.admin, world, 'Najstariji zatvoreni', '2026-10-01T08:00')
  await handOff(world.admin, doneId, partner.id)
  await expectOk(await call('POST', `/api/rides/${doneId}/done`, world.admin, {}))

  const base = instantFromWallClock('2026-10-01T10:00', zone).getTime()
  const seeded: { guestName: string, pickupAt: string }[] = []
  for (let index = 0; index < pageSize; index += 1) {
    const guestName = `n${String(index).padStart(2, '0')}`
    const pickupAt = new Date(base + index * 60_000).toISOString()
    await ownerPool.query(
      `insert into app.transfers (
        tenant_id, client_id, pickup_at, start_location_id, end_location_id,
        passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count,
        external_id
      ) values ($1, $2, $3, $4, $5, 1, $6, '10.00', 'cash', false, 0, 0, gen_random_uuid()::text)`,
      [world.tenantId, world.client.id, pickupAt, world.start.id, world.end.id, guestName],
    )
    await ownerPool.query(
      `insert into app.rides (tenant_id, transfer_id, state, partner_id)
       select $1, id, 'handed_off', $2 from app.transfers
       where tenant_id = $1 and guest_name = $3`,
      [world.tenantId, partner.id, guestName],
    )
    seeded.push({ guestName, pickupAt })
  }
  const newestFirst = [...seeded].sort((left, right) => right.pickupAt.localeCompare(left.pickupAt))

  const first = rideHistorySchema.parse(await (await call('GET', `/api/partners/${partner.id}/ride-history`, world.admin)).json())
  expect(first.rides.map(ride => ride.guestName)).toEqual(newestFirst.map(ride => ride.guestName))
  expect(first.nextCursor).toEqual(expect.any(String))
  expect(first.counts).toEqual({ total: pageSize + 1, done: 1, noShow: 0, cancelled: 0 })

  const second = rideHistorySchema.parse(await (await call(
    'GET',
    `/api/partners/${partner.id}/ride-history?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    world.admin,
  )).json())
  expect(second.rides.map(ride => ride.guestName)).toEqual(['Najstariji zatvoreni'])
  expect(second.rides[0]).toMatchObject({ state: 'done', partnerName: 'Dugi podizvođač', driverName: null })
  expect(second.nextCursor).toBeNull()
  expect(second.counts).toEqual(first.counts)
})

it('returns the Partner phone and email on a handed-off Ride, and the Driver reads carry none of it', async () => {
  const world = await office('prh-contact')
  const driverUserId = await addMember(world.tenantId, 'prh-contact-driver@example.test', 'Marko Vozač', 'driver')
  const driver = await signIn('prh-contact-driver@example.test')
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer', phone, email, note })
  const linked = await createDriver(world.admin, {
    name: 'Marko Vozač',
    kind: 'own',
    phone: '+385911114152',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
    memberUserId: driverUserId,
  })
  const vehicle = await createVehicle(world.admin, {
    registrationPlate: 'DU415BB',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })

  const handedId = await recordRide(world.dispatcher, world, 'Predani gost', '2026-10-22T14:00')
  await handOff(world.dispatcher, handedId, partner.id)
  const assignedId = await recordRide(world.dispatcher, world, 'Dodijeljeni gost', '2026-10-23T14:00')
  await assignRide(world.admin, { rideId: assignedId, driverId: linked.id, vehicleId: vehicle.id, version: 0 })

  const handedDay = transferDaySchema.parse(await (await call('GET', '/api/transfers?date=2026-10-22', world.dispatcher)).json())
  expect(handedDay.partnerBriefs).toEqual([{ partnerId: partner.id, phone, email }])
  expect(JSON.stringify(handedDay)).not.toContain(note)
  const assignedDay = transferDaySchema.parse(await (await call('GET', '/api/transfers?date=2026-10-23', world.admin)).json())
  expect(assignedDay.partnerBriefs).toEqual([])
  expect(JSON.stringify(assignedDay)).not.toContain(phone)
  expect(JSON.stringify(assignedDay)).not.toContain(email)

  await archivePartner(world.admin, partner.id)
  const archivedDay = transferDaySchema.parse(await (await call('GET', '/api/transfers?date=2026-10-22', world.admin)).json())
  expect(archivedDay.partnerBriefs).toEqual([{ partnerId: partner.id, phone, email }])

  const refused = await call('GET', '/api/transfers?date=2026-10-22', driver)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)

  const upcoming = await call('GET', '/api/rides/upcoming', driver)
  expect(upcoming.status).toBe(200)
  const upcomingText = await upcoming.text()
  expect(upcomingText).toContain('Dodijeljeni gost')
  expect(upcomingText).not.toContain(phone)
  expect(upcomingText).not.toContain(email)
  expect(upcomingText).not.toContain(note)
  expect(upcomingText).not.toContain('partnerBriefs')
})

async function handOff(session: Headers, rideId: string, partnerId: string): Promise<void> {
  await expectOk(await call('POST', `/api/rides/${rideId}/hand-off`, session, { partnerId, version: 0 }))
}
