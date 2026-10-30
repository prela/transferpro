import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, correctedTransferResultSchema, instantFromWallClock, transferGroupSchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { createPartner } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { acceptRide, assignRide, cancelRide, correctTransfer, createTransfer, handOffRide, readTransferGroup } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import patchTransfer from './transfers/[id].patch'
import getTransferGroup from './transfers/[id]/group.get'

/**
 * GET /api/transfers/:id/group. Admin and dispatcher may read it. A driver
 * is 403. No session is 401. A bad id is 400 before a session. Another
 * Tenant is 404. Members keep their own pickup, including one on another
 * day. A route change of the main Transfer reports unfinished extra
 * vehicles and does not write them. A guest change and an extra vehicle's
 * own route change report zero. Applying the change copies the pickup,
 * the start and end Locations, and the flight onto unfinished extra vehicles,
 * and a refusal writes nothing for any Transfer in the group.
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
const password = 'transfer-group-http-password'
const zone = 'Europe/Zagreb'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  const marker = '/api/transfers/'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
  const [id, action] = relative.split('/')
  if (!action && event.method === 'PATCH') {
    event.context.params = { id: id ?? '' }
    return patchTransfer(event)
  }
  if (action === 'group' && event.method === 'GET') {
    event.context.params = { id: id ?? '' }
    return getTransferGroup(event)
  }
  return new Response('Not Found', { status: 404 })
})
const callGroup = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'tgr-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'tgr-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'tgr-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'tgr-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'tgr-%'`)
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

function call(session: Headers | undefined, id: string) {
  return callGroup(new Request(`http://localhost/api/transfers/${id}/group`, {
    method: 'GET',
    headers: session,
  }))
}

function callPatch(session: Headers, id: string, body: unknown) {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return callGroup(new Request(`http://localhost/api/transfers/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  }))
}

async function versionOf(transferId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    `select version from app.transfers where id = $1`,
    [transferId],
  )
  return Number(result.rows[0]?.version ?? 0)
}

it('refuses a signed-out request, a driver, and a bad id before a session', async () => {
  const created = await tenant('tgr-role', 'Hana Admin')
  await addMember(created.tenantId, 'tgr-role-driver@example.test', 'Drago Driver', 'driver')
  const driver = await signIn('tgr-role-driver@example.test')
  const guest = 'Ana Grupno'
  const admin = await signIn('tgr-role-admin@example.test')
  const client = await createClient(admin, { name: 'Agencija Grupa', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Polazak Grupe', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Dolazak Grupe', kind: 'hotel' })
  const day = calendarDateInTimeZone(zone, new Date())
  const recorded = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: client.id,
    pickupAt: instantFromWallClock(`${day}T12:00`, zone).toISOString(),
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 2,
    guestName: guest,
    flightNumber: 'OU100',
    price: 20,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })

  const unsigned = await call(undefined, recorded.transfer.id)
  expect(unsigned.status).toBe(401)
  expect(await unsigned.text()).not.toContain(guest)
  await expect(readTransferGroup(new Headers(), recorded.transfer.id)).rejects.toMatchObject({ statusCode: 401 })

  const refused = await call(driver, recorded.transfer.id)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(guest)
  await expect(readTransferGroup(driver, recorded.transfer.id)).rejects.toMatchObject({ statusCode: 403 })

  const bad = await call(admin, 'not-a-uuid')
  expect(bad.status).toBe(400)
  await bad.text()
  await expect(readTransferGroup(admin, 'not-a-uuid')).rejects.toMatchObject({ statusCode: 400 })
})

it('lists each member on that member pickup, and hides another Tenant', async () => {
  const created = await tenant('tgr-list', 'Hana Admin')
  await addMember(created.tenantId, 'tgr-list-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const admin = await signIn('tgr-list-admin@example.test')
  const dispatcher = await signIn('tgr-list-dispatcher@example.test')
  const outsiderTenant = await tenant('tgr-outsider', 'Iva Admin')
  const outsider = await signIn('tgr-outsider-admin@example.test')
  const client = await createClient(admin, { name: 'Agencija Grupa', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Polazak Grupe', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Dolazak Grupe', kind: 'hotel' })
  const otherEnd = await createLocation(admin, { name: 'Dolazak Drugi', kind: 'address' })
  const day = calendarDateInTimeZone(zone, new Date())
  const next = addCalendarDays(day, 1)
  const mainPickup = instantFromWallClock(`${day}T12:00`, zone).toISOString()
  const finishedPickup = instantFromWallClock(`${day}T13:00`, zone).toISOString()
  const extraPickup = instantFromWallClock(`${next}T12:00`, zone).toISOString()

  const main = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: client.id,
    pickupAt: mainPickup,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 4,
    guestName: 'Ana Grupno',
    flightNumber: 'OU384',
    price: 40,
    payment: 'cash',
    airportMark: true,
    luggageCount: 1,
    childSeatCount: 0,
  })
  const finished = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: client.id,
    pickupAt: finishedPickup,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 1,
    guestName: 'Mia Završena',
    flightNumber: 'OU384',
    price: 0,
    payment: 'cash',
    airportMark: true,
    luggageCount: 0,
    childSeatCount: 0,
    mainTransferId: main.transfer.id,
    groupPassengerCount: 9,
    mainVersion: 0,
  })
  const extra = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: client.id,
    pickupAt: extraPickup,
    startLocationId: start.id,
    endLocationId: otherEnd.id,
    passengerCount: 2,
    guestName: 'Iva Dodatna',
    flightNumber: 'OU384',
    price: 0,
    payment: 'cash',
    airportMark: true,
    luggageCount: 0,
    childSeatCount: 0,
    mainTransferId: main.transfer.id,
  })
  await cancelRide(admin, finished.ride.id, {})

  const ordinary = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: client.id,
    pickupAt: mainPickup,
    startLocationId: start.id,
    endLocationId: end.id,
    passengerCount: 1,
    guestName: 'Iva Sama',
    price: 15,
    payment: 'card',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })

  const fromAdmin = transferGroupSchema.parse(await readTransferGroup(admin, main.transfer.id))
  const fromDispatcher = transferGroupSchema.parse(await readTransferGroup(dispatcher, extra.transfer.id))
  expect(fromDispatcher).toEqual(fromAdmin)
  expect(fromAdmin.members.map(member => member.pickupAt)).toEqual([mainPickup, finishedPickup, extraPickup])
  expect(fromAdmin.members.map(member => member.guestName)).toEqual(['Ana Grupno', 'Mia Završena', 'Iva Dodatna'])
  expect(fromAdmin.members.map(member => member.endLocationId)).toEqual([end.id, end.id, otherEnd.id])
  expect(fromAdmin.members.map(member => member.groupPassengerCount)).toEqual([9, null, null])
  expect(fromAdmin.members.map(member => member.state)).toEqual(['unassigned', 'cancelled', 'unassigned'])
  expect(fromAdmin.members.map(member => member.mainTransferId)).toEqual([null, main.transfer.id, main.transfer.id])
  expect(JSON.stringify(fromAdmin)).not.toContain('groupPickup')

  const httpGroup = transferGroupSchema.parse(await (await call(dispatcher, main.transfer.id)).json())
  expect(httpGroup).toEqual(fromAdmin)

  expect(transferGroupSchema.parse(await readTransferGroup(admin, ordinary.transfer.id)).members).toEqual([])
  const ordinaryHttp = await call(admin, ordinary.transfer.id)
  expect(ordinaryHttp.status).toBe(200)
  expect(transferGroupSchema.parse(await ordinaryHttp.json()).members).toEqual([])

  const foreign = await call(outsider, main.transfer.id)
  expect(foreign.status).toBe(404)
  const foreignText = await foreign.text()
  expect(foreignText).not.toContain('Ana Grupno')
  expect(foreignText).not.toContain('Iva Dodatna')
  expect(foreignText).not.toContain('Mia Završena')
  await expect(readTransferGroup(outsider, main.transfer.id)).rejects.toMatchObject({ statusCode: 404 })
  expect(outsiderTenant.tenantId).not.toBe(created.tenantId)
})

it('reports unfinished extra vehicles only for a route change of the main Transfer', async () => {
  const created = await tenant('tgr-notice', 'Hana Admin')
  const admin = await signIn('tgr-notice-admin@example.test')
  const client = await createClient(admin, { name: 'Agencija Grupa', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Polazak Grupe', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Dolazak Grupe', kind: 'hotel' })
  const day = calendarDateInTimeZone(zone, new Date())
  const next = addCalendarDays(day, 1)
  const mainPickup = instantFromWallClock(`${day}T12:00`, zone).toISOString()
  const extraPickup = instantFromWallClock(`${next}T09:00`, zone).toISOString()
  const shared = {
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
    flightNumber: 'OU384',
    payment: 'cash' as const,
    airportMark: true,
    luggageCount: 0,
    childSeatCount: 0,
    tabla: 'ANA',
    clientReference: 'G-1',
  }
  const main = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: mainPickup,
    passengerCount: 4,
    guestName: 'Ana Grupno',
    price: 40,
  })
  const extra = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: extraPickup,
    passengerCount: 2,
    guestName: 'Iva Dodatna',
    price: 0,
    mainTransferId: main.transfer.id,
    groupPassengerCount: 9,
    mainVersion: 0,
  })
  const done = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: instantFromWallClock(`${day}T15:00`, zone).toISOString(),
    passengerCount: 1,
    guestName: 'Mia Završena',
    price: 0,
    mainTransferId: main.transfer.id,
  })
  await cancelRide(admin, done.ride.id, {})

  const mainBody = {
    ...shared,
    pickupAt: mainPickup,
    passengerCount: 4,
    guestName: 'Ana Grupno',
    price: 40,
  }
  const counted = correctedTransferResultSchema.parse(await correctTransfer(admin, main.transfer.id, {
    ...mainBody,
    groupPassengerCount: 11,
    version: await versionOf(main.transfer.id),
  }))
  expect(counted.unfinishedExtraVehicleCount).toBe(0)
  expect(counted.transfer.groupPassengerCount).toBe(11)

  const routed = correctedTransferResultSchema.parse(await correctTransfer(admin, main.transfer.id, {
    ...mainBody,
    flightNumber: 'OU392',
    version: await versionOf(main.transfer.id),
  }))
  expect(routed.unfinishedExtraVehicleCount).toBe(1)
  expect(routed.transfer.flightNumber).toBe('OU392')

  const storedExtra = await ownerPool.query<{ flight_number: string, pickup_at: Date }>(
    `select flight_number, pickup_at from app.transfers where id = $1`,
    [extra.transfer.id],
  )
  expect(storedExtra.rows).toEqual([{ flight_number: 'OU384', pickup_at: new Date(extraPickup) }])

  const guestOnly = correctedTransferResultSchema.parse(await correctTransfer(admin, main.transfer.id, {
    ...mainBody,
    flightNumber: 'OU392',
    guestName: 'Ana Nova',
    version: await versionOf(main.transfer.id),
  }))
  expect(guestOnly.unfinishedExtraVehicleCount).toBe(0)

  const extraRoute = correctedTransferResultSchema.parse(await correctTransfer(admin, extra.transfer.id, {
    ...shared,
    pickupAt: extraPickup,
    passengerCount: 2,
    guestName: 'Iva Dodatna',
    price: 0,
    flightNumber: 'OU500',
    version: await versionOf(extra.transfer.id),
  }))
  expect(extraRoute.unfinishedExtraVehicleCount).toBe(0)
  const storedMain = await ownerPool.query<{ flight_number: string }>(
    `select flight_number from app.transfers where id = $1`,
    [main.transfer.id],
  )
  expect(storedMain.rows).toEqual([{ flight_number: 'OU392' }])

  const listed = transferGroupSchema.parse(await readTransferGroup(admin, extra.transfer.id))
  expect(listed.members.find(member => member.transferId === main.transfer.id)?.groupPassengerCount).toBe(11)
  expect(listed.members.find(member => member.transferId === extra.transfer.id)?.pickupAt).toBe(extraPickup)
  expect(listed.members.find(member => member.transferId === extra.transfer.id)?.groupPassengerCount).toBeNull()
  expect(created.tenantId).toBeTruthy()
})

it('applies a main Transfer route correction to unfinished extra vehicles and writes nothing when refused', async () => {
  const created = await tenant('tgr-apply', 'Hana Admin')
  const admin = await signIn('tgr-apply-admin@example.test')
  const driverUserId = await addMember(created.tenantId, 'tgr-apply-driver@example.test', 'Drago Vozač', 'driver')
  const driverSession = await signIn('tgr-apply-driver@example.test')
  const client = await createClient(admin, { name: 'Agencija Primjena', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Polazak Primjene', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Dolazak Primjene', kind: 'hotel' })
  const otherEnd = await createLocation(admin, { name: 'Drugi Primjene', kind: 'address' })
  const partner = await createPartner(admin, { name: 'Partner Primjena' })
  const driver = await createDriver(admin, {
    name: 'Drago Vozač',
    kind: 'own',
    phone: '+385911114681',
    drivingLicenceExpiresOn: '2031-01-01',
    transportLicenceExpiresOn: '2031-01-01',
    memberUserId: driverUserId,
  })
  await updateDriver(admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(admin, {
    registrationPlate: 'ZG4681AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2031-01-01',
    technicalInspectionExpiresOn: '2031-01-01',
    insuranceExpiresOn: '2031-01-01',
  })
  const day = calendarDateInTimeZone(zone, new Date())
  const at = (hour: string) => instantFromWallClock(`${day}T${hour}`, zone).toISOString()
  const shared = {
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
    flightNumber: 'OU384',
    payment: 'cash' as const,
    airportMark: true,
    luggageCount: 1,
    childSeatCount: 0,
    tabla: 'ANA',
    clientReference: 'G-1',
  }
  const blocker = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: at('10:00'),
    passengerCount: 1,
    guestName: 'Blok Vozač',
    price: 20,
    note: 'Drži vozilo',
  })
  const main = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: at('12:00'),
    passengerCount: 4,
    guestName: 'Ana Grupno',
    price: 40,
    note: 'Glavni',
  })
  const accepted = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: at('14:00'),
    passengerCount: 2,
    guestName: 'Iva Dodatna',
    price: 0,
    payment: 'card',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 1,
    tabla: 'IVA',
    clientReference: 'G-1',
    note: 'Samo dodatno',
    mainTransferId: main.transfer.id,
    groupPassengerCount: 9,
    mainVersion: 0,
  })
  const handed = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: at('15:00'),
    passengerCount: 1,
    guestName: 'Lea Predana',
    price: 0,
    note: 'Predano',
    tabla: 'LEA',
    mainTransferId: main.transfer.id,
  })
  const finished = await createTransfer(admin, {
    ...shared,
    externalId: crypto.randomUUID(),
    pickupAt: at('16:00'),
    passengerCount: 1,
    guestName: 'Mia Završena',
    price: 0,
    note: 'Gotovo',
    tabla: 'MIA',
    mainTransferId: main.transfer.id,
  })
  await assignRide(admin, { rideId: blocker.ride.id, driverId: driver.id, vehicleId: vehicle.id, version: await versionOf(blocker.transfer.id) })
  await assignRide(admin, { rideId: accepted.ride.id, driverId: driver.id, vehicleId: vehicle.id, version: await versionOf(accepted.transfer.id) })
  await acceptRide(driverSession, accepted.ride.id, {})
  await handOffRide(admin, handed.ride.id, { partnerId: partner.id, version: await versionOf(handed.transfer.id) })
  await cancelRide(admin, finished.ride.id, {})
  const landed = at('14:05')
  await ownerPool.query(
    `update app.transfers
     set landing_at = $2,
         expected_arrival_at = $2,
         expected_arrival_basis_at = $2,
         flight_will_not_arrive = true,
         flight_will_not_arrive_handed = true
     where id = $1`,
    [accepted.transfer.id, landed],
  )

  const mainBody = {
    ...shared,
    pickupAt: at('12:00'),
    passengerCount: 4,
    guestName: 'Ana Grupno',
    price: 40,
    note: 'Glavni',
  }
  const before = await groupSnapshot(created.tenantId, [
    main.transfer.id,
    accepted.transfer.id,
    handed.transfer.id,
    finished.transfer.id,
    blocker.transfer.id,
  ])

  const stale = await callPatch(admin, main.transfer.id, {
    ...mainBody,
    pickupAt: at('10:30'),
    applyToExtraVehicles: true,
    version: (await versionOf(main.transfer.id)) + 9,
  })
  expect(stale.status).toBe(409)
  expect(await stale.text()).toContain('stale_save')
  expect(await groupSnapshot(created.tenantId, [
    main.transfer.id,
    accepted.transfer.id,
    handed.transfer.id,
    finished.transfer.id,
    blocker.transfer.id,
  ])).toEqual(before)

  const refused = await callPatch(admin, main.transfer.id, {
    ...mainBody,
    pickupAt: at('10:30'),
    applyToExtraVehicles: true,
    version: await versionOf(main.transfer.id),
  })
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_overlap')
  expect(await groupSnapshot(created.tenantId, [
    main.transfer.id,
    accepted.transfer.id,
    handed.transfer.id,
    finished.transfer.id,
    blocker.transfer.id,
  ])).toEqual(before)

  const saved = correctedTransferResultSchema.parse(await (await callPatch(admin, main.transfer.id, {
    ...mainBody,
    guestName: 'Ana Nova',
    endLocationId: otherEnd.id,
    flightNumber: 'OU392',
    applyToExtraVehicles: true,
    version: await versionOf(main.transfer.id),
  })).json())
  expect(saved.unfinishedExtraVehicleCount).toBe(0)
  expect(saved.transfer).toMatchObject({
    guestName: 'Ana Nova',
    endLocationId: otherEnd.id,
    flightNumber: 'OU392',
    pickupAt: at('12:00'),
  })
  expect(saved.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])

  const rows = await transferRows([main.transfer.id, accepted.transfer.id, handed.transfer.id, finished.transfer.id])
  const acceptedRow = rows.find(row => row.id === accepted.transfer.id)
  const handedRow = rows.find(row => row.id === handed.transfer.id)
  const finishedRow = rows.find(row => row.id === finished.transfer.id)
  const mainRow = rows.find(row => row.id === main.transfer.id)
  expect(acceptedRow).toMatchObject({
    guest_name: 'Iva Dodatna',
    note: 'Samo dodatno',
    passenger_count: 2,
    price: '0.00',
    payment: 'card',
    airport_mark: false,
    luggage_count: 0,
    child_seat_count: 1,
    tabla: 'IVA',
    client_reference: 'G-1',
    start_location_id: start.id,
    end_location_id: otherEnd.id,
    flight_number: 'OU392',
    pickup_at: new Date(at('14:00')),
    landing_at: null,
    expected_arrival_at: null,
    flight_will_not_arrive: false,
    state: 'assigned',
    version: before.versions[accepted.transfer.id]! + 1,
  })
  expect(handedRow).toMatchObject({
    guest_name: 'Lea Predana',
    note: 'Predano',
    tabla: 'LEA',
    end_location_id: otherEnd.id,
    flight_number: 'OU392',
    pickup_at: new Date(at('15:00')),
    state: 'handed_off',
    version: before.versions[handed.transfer.id]! + 1,
  })
  expect(finishedRow).toMatchObject({
    guest_name: 'Mia Završena',
    note: 'Gotovo',
    tabla: 'MIA',
    end_location_id: end.id,
    flight_number: 'OU384',
    state: 'cancelled',
    version: before.versions[finished.transfer.id],
  })
  expect(mainRow?.version).toBe(before.versions[main.transfer.id]! + 1)
  expect(before.versions[blocker.transfer.id]).toBe(await versionOf(blocker.transfer.id))

  const audits = await correctionAudits(created.tenantId)
  const corrected = audits.filter(row => row.action === 'transfer.corrected')
  expect(corrected.filter(row => row.transfer_id === accepted.transfer.id)).toEqual([
    expect.objectContaining({ fields: ['endLocationId', 'flightNumber'] }),
  ])
  expect(corrected.filter(row => row.transfer_id === handed.transfer.id)).toEqual([
    expect.objectContaining({ fields: ['endLocationId', 'flightNumber'] }),
  ])
  expect(corrected.filter(row => row.transfer_id === finished.transfer.id)).toEqual([])
  expect(corrected.filter(row => row.transfer_id === main.transfer.id && row.fields.includes('flightNumber'))).toEqual([
    expect.objectContaining({ fields: ['endLocationId', 'guestName', 'flightNumber'] }),
  ])
  expect(audits.filter(row => row.action === 'ride.returned_to_assigned').map(row => row.ride_id)).toEqual([accepted.ride.id])

  const changedMail = (await outboxRows(created.tenantId)).filter(row => row.work_order_status === 'changed')
  expect(changedMail).toEqual([{ ride_id: accepted.ride.id, work_order_status: 'changed' }])
  expect(created.tenantId).not.toBe('')
})

async function groupSnapshot(tenantId: string, transferIds: string[]) {
  const transfers = await transferRows(transferIds)
  const audits = await correctionAudits(tenantId)
  const outbox = await outboxRows(tenantId)
  return {
    transfers,
    audits,
    outbox,
    versions: Object.fromEntries(transfers.map(row => [row.id, row.version])),
  }
}

async function transferRows(transferIds: string[]) {
  const result = await ownerPool.query<{
    id: string
    version: number
    guest_name: string
    note: string | null
    passenger_count: number
    price: string
    payment: string
    airport_mark: boolean
    luggage_count: number
    child_seat_count: number
    tabla: string
    client_reference: string | null
    start_location_id: string
    end_location_id: string
    flight_number: string | null
    pickup_at: Date
    landing_at: Date | null
    expected_arrival_at: Date | null
    flight_will_not_arrive: boolean
    state: string
  }>(
    `select t.id, t.version, t.guest_name, t.note, t.passenger_count, t.price::text as price,
            t.payment, t.airport_mark, t.luggage_count, t.child_seat_count, t.tabla,
            t.client_reference, t.start_location_id, t.end_location_id, t.flight_number,
            t.pickup_at, t.landing_at, t.expected_arrival_at, t.flight_will_not_arrive,
            r.state
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where t.id = any($1::uuid[])
     order by t.id`,
    [transferIds],
  )
  return result.rows
}

async function correctionAudits(tenantId: string) {
  const result = await ownerPool.query<{
    action: string
    transfer_id: string | null
    ride_id: string | null
    fields: string[]
  }>(
    `select action::text as action,
            data->>'transferId' as transfer_id,
            data->>'rideId' as ride_id,
            array(select jsonb_array_elements_text(data->'fields')) as fields
     from app.audit_entry
     where tenant_id = $1
       and action::text in ('transfer.corrected', 'ride.returned_to_assigned')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function outboxRows(tenantId: string) {
  const result = await ownerPool.query<{ ride_id: string | null, work_order_status: string | null }>(
    `select ride_id, work_order_status
     from app.mail_outbox
     where tenant_id = $1
     order by created_at, id`,
    [tenantId],
  )
  return result.rows
}
