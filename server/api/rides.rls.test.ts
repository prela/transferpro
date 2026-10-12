import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../../shared'
import { captureLogs } from '../core/testing'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { setRosterDay } from '../modules/roster'
import { closeTenantRuntime, createTenant, handleAuthRequest, updateUserLocale } from '../modules/tenancy'
import { assignRide, changeVehicle, clearRide, createTransfer, listTransferDay, listUpcomingRides, reassignRide } from '../modules/transfers'
import { archiveVehicle, createVehicle } from '../modules/vehicles'
import postAcceptByPhone from './rides/[id]/accept-by-phone.post'
import postAccept from './rides/[id]/accept.post'
import postAssign from './rides/[id]/assign.post'
import postCancel from './rides/[id]/cancel.post'
import postClear from './rides/[id]/clear.post'
import postDecline from './rides/[id]/decline.post'
import postDone from './rides/[id]/done.post'
import postReassign from './rides/[id]/reassign.post'
import getRosterVehicle from './rides/[id]/roster-vehicle.get'
import postVehicle from './rides/[id]/vehicle.post'

/**
 * POST /api/rides/:id/assign, GET /api/rides/:id/roster-vehicle,
 * POST /api/rides/:id/accept, POST /api/rides/:id/accept-by-phone,
 * POST /api/rides/:id/done, POST /api/rides/:id/cancel, and POST /api/rides/:id/decline.
 * An invalid body is answered before a session exists. The role cases use a
 * real sign-in. The composite foreign key is also tried as the app role.
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
  if (action === 'vehicle' && event.method === 'POST')
    return postVehicle(event)
  if (action === 'clear' && event.method === 'POST')
    return postClear(event)
  if (action === 'reassign' && event.method === 'POST')
    return postReassign(event)
  if (action === 'accept' && event.method === 'POST')
    return postAccept(event)
  if (action === 'accept-by-phone' && event.method === 'POST')
    return postAcceptByPhone(event)
  if (action === 'done' && event.method === 'POST')
    return postDone(event)
  if (action === 'cancel' && event.method === 'POST')
    return postCancel(event)
  if (action === 'decline' && event.method === 'POST')
    return postDecline(event)
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
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'hasg-%'
    )`)
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

/**
 * Local midnight of a Zagreb calendar day a few days ahead, and one minute
 * before it. The roster keeps that calendar date. The Ride day bound is
 * 05:00 and is not used here. Both instants stay inside the pickup window.
 */
function zagrebMidnightBoundary() {
  const day = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 3)
  const midnight = instantFromWallClock(`${day}T00:00`, 'Europe/Zagreb')
  return {
    day,
    previous: addCalendarDays(day, -1),
    beforePickup: new Date(midnight.getTime() - 60 * 1000).toISOString(),
    afterPickup: midnight.toISOString(),
  }
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
  const firstPickup = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const first = await createTransfer(world.dispatcher, transferBody(world, firstPickup.toISOString()))
  const second = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()))
  // A dispatcher pre-fill would return this Vehicle. The driver must not.
  await setRosterDay(world.dispatcher, {
    rosterDate: calendarDateInTimeZone('Europe/Zagreb', firstPickup),
    driverId: driver.id,
    vehicleId: vehicle.id,
  })

  const refused = await call('POST', `/api/rides/${first.ride.id}/assign`, driverSession, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })
  expect(await assignmentAudits(world.tenantId)).toEqual([])

  const rosterRead = await call('GET', `/api/rides/${first.ride.id}/roster-vehicle?driverId=${driver.id}`, driverSession)
  expect(rosterRead.status).toBe(403)
  expect(await rosterRead.text()).not.toContain(vehicle.id)
  expect(await rideRow(first.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })

  const assigned = await call('POST', `/api/rides/${first.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toEqual({
    ride: {
      id: first.ride.id,
      transferId: first.transfer.id,
      state: 'assigned',
      driverId: driver.id,
      vehicleId: vehicle.id,
      mustAccept: true,
    },
    workOrders: [{ driverId: driver.id, outcome: 'no_email' }],
    relocationWarnings: [],
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
  expect(await later.json()).toMatchObject({ ride: { mustAccept: false }, workOrders: [{ driverId: driver.id, outcome: 'no_email' }] })
})

it('an overlapping assign is 409 and writes nothing, and another Tenant Ride is not visible', async () => {
  const world = await office('hasg-ovlp')
  const other = await office('hasg-ovlp-b')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110184' })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG184AA'))
  const otherDriver = await createDriver(other.dispatcher, { ...driverBody, phone: '+385911110185' })
  const otherVehicle = await createVehicle(other.dispatcher, vehicleBody('ZG184BB'))
  const held = await createTransfer(world.dispatcher, transferBody(world, '2026-11-02T10:00:00.000Z'))
  const next = await createTransfer(world.dispatcher, transferBody(world, '2026-11-02T10:30:00.000Z'))
  const foreign = await createTransfer(other.dispatcher, transferBody(other, '2026-11-02T10:00:00.000Z'))
  expect((await call('POST', `/api/rides/${held.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${foreign.ride.id}/assign`, other.dispatcher, {
    driverId: otherDriver.id,
    vehicleId: otherVehicle.id,
  })).status).toBe(200)

  const refused = await call('POST', `/api/rides/${next.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_overlap')
  expect(await rideRow(next.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await assignmentAudits(world.tenantId)).toHaveLength(1)

  // The occupation read is this session’s assigned and accepted rows. RLS hides the other Tenant.
  const seen = await withAppTenant(world.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `select r.id from app.rides as r where r.state in ('assigned', 'accepted')`,
    )
    return result.rows.map(row => row.id)
  })
  expect(seen).toContain(held.ride.id)
  expect(seen).not.toContain(foreign.ride.id)
})

it('emails an assigned work order in the tenant locale, and a rejected send leaves the Ride assigned', async () => {
  const world = await office('hasg-order')
  await updateUserLocale(world.dispatcher, 'en')
  const address = 'ana-order@example.test'
  const guestName = 'Gost Tajna'
  const tabla = 'TABLA-TAJNA'
  const plate = 'ZG9ORDER'
  const driver = await createDriver(world.dispatcher, {
    ...driverBody,
    phone: '+385911110088',
    email: address,
  })
  const vehicle = await createVehicle(world.dispatcher, {
    ...vehicleBody(plate),
    description: 'Mercedes Vito',
  })
  const recorded = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-15T22:30:00.000Z'),
    guestName,
    passengerCount: 2,
    luggageCount: 1,
    flightNumber: 'OU412',
    price: 77.5,
    tabla,
    note: 'Napomena za vozača',
  })
  const sent: Array<{ to: string, subject: string, text: string, html: string }> = []
  const assigned = await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
  }, {
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder(mail) {
        sent.push(mail)
      },
    },
  })
  expect(assigned.ride).toMatchObject({ state: 'assigned', driverId: driver.id, mustAccept: false })
  expect(assigned.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(JSON.stringify(assigned)).not.toContain(address)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toBe(address)
  expect(sent[0]?.subject).toBe('Dodijeljeno · 16. 10. 2026. 00:30 · Zračna luka Dubrovnik')
  expect(sent[0]?.text).toContain('Gost: Gost Tajna')
  expect(sent[0]?.text).toContain('Tabla: TABLA-TAJNA')
  expect(sent[0]?.text).toContain('Let: OU412')
  expect(sent[0]?.text).toContain('Odredište: Hotel Park')
  expect(sent[0]?.text).toContain('Klijent: Agencija Mora')
  expect(sent[0]?.text).toContain('Vozilo: Mercedes Vito')
  expect(sent[0]?.text).toContain('Registracija: ZG9ORDER')
  expect(sent[0]?.text).toContain('Napomena: Napomena za vozača')
  expect(sent[0]?.text).toContain('Cijena: 77,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  expect(sent[0]?.html).not.toContain('href=')
  expect(sent[0]?.text.toLowerCase()).not.toContain('prihvat')
  const audits = await assignmentAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  expect(audits[0]?.data).toEqual({
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
  })
  expect(JSON.stringify(audits)).not.toContain(address)
  expect(JSON.stringify(audits)).not.toContain(guestName)

  const logs = captureLogs()
  const failedRide = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-16T22:30:00.000Z'),
    guestName,
    price: 77.5,
    tabla,
  })
  const failed = await assignRide(world.dispatcher, {
    rideId: failedRide.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
  }, {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder() {
        throw new Error(`rejected ${address} ${guestName} ${tabla} ${plate}`)
      },
    },
  })
  expect(failed.workOrders).toEqual([{ driverId: driver.id, outcome: 'failed' }])
  expect(await rideRow(failedRide.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
  })
  expect(await assignmentAudits(world.tenantId)).toHaveLength(2)
  const [line] = logs.lines()
  const text = JSON.stringify(line)
  expect(text).toContain(failedRide.ride.id)
  expect(text).toContain(driver.id)
  expect(text).not.toContain(address)
  expect(text).not.toContain(guestName)
  expect(text).not.toContain(tabla)
  expect(text).not.toContain(plate)
  expect(text).not.toContain('77.50')
  expect(text).not.toContain('77,50')
})

it('emails a changed work order with the cash price, and a rejected send leaves the Vehicle', async () => {
  const world = await office('hasg-chg-mail')
  await updateUserLocale(world.dispatcher, 'en')
  const address = 'ana-change@example.test'
  const guestName = 'Gost Promjena'
  const driver = await createDriver(world.dispatcher, {
    ...driverBody,
    name: 'Ana Change',
    phone: '+385911110181',
    email: address,
  })
  const kept = await createVehicle(world.dispatcher, { ...vehicleBody('ZG9181AA'), description: 'Stari kombi' })
  const next = await createVehicle(world.dispatcher, { ...vehicleBody('ZG9181BB'), description: 'Novi kombi' })
  const recorded = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-15T22:30:00.000Z'),
    guestName,
    price: 42.5,
    payment: 'cash',
  })
  await assignRide(world.dispatcher, { rideId: recorded.ride.id, driverId: driver.id, vehicleId: kept.id })
  const sent: Array<{ to: string, subject: string, text: string }> = []
  const changed = await changeVehicle(world.dispatcher, {
    rideId: recorded.ride.id,
    vehicleId: next.id,
  }, {
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder(mail) {
        sent.push(mail)
      },
    },
  })
  expect(changed.ride).toMatchObject({ state: 'assigned', driverId: driver.id, vehicleId: next.id })
  expect(changed.workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(JSON.stringify(changed)).not.toContain(address)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toBe(address)
  expect(sent[0]?.subject).toBe('Promijenjeno · 16. 10. 2026. 00:30 · Zračna luka Dubrovnik')
  expect(sent[0]?.text.startsWith('Promijenjeno\n')).toBe(true)
  expect(sent[0]?.text).toContain('Vozilo: Novi kombi')
  expect(sent[0]?.text).toContain('Registracija: ZG9181BB')
  expect(sent[0]?.text).not.toContain('ZG9181AA')
  expect(sent[0]?.text).toContain('Cijena: 42,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  const audits = await changeAudits(world.tenantId)
  expect(audits.map(row => row.action)).toEqual(['ride.vehicle_changed'])
  expect(JSON.stringify(audits)).not.toContain(address)
  expect(JSON.stringify(audits)).not.toContain('email')

  const logs = captureLogs()
  const failed = await changeVehicle(world.dispatcher, {
    rideId: recorded.ride.id,
    vehicleId: kept.id,
  }, {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder() {
        throw new Error(`rejected ${address} ${guestName}`)
      },
    },
  })
  expect(failed.workOrders).toEqual([{ driverId: driver.id, outcome: 'failed' }])
  expect(await rideRow(recorded.ride.id)).toMatchObject({ vehicle_id: kept.id, driver_id: driver.id, state: 'assigned' })
  expect(await changeAudits(world.tenantId)).toHaveLength(2)
  const line = JSON.stringify(logs.lines()[0])
  expect(line).toContain(recorded.ride.id)
  expect(line).toContain(driver.id)
  expect(line).not.toContain(address)
  expect(line).not.toContain(guestName)
})

it('reports each Driver on a reassign, and a clear states no price even when the send fails', async () => {
  const world = await office('hasg-move-mail')
  const nextAddress = 'iva-next@example.test'
  const previousAddress = 'ana-prev@example.test'
  const guestName = 'Gost Prebacivanje'
  const previous = await createDriver(world.dispatcher, {
    ...driverBody,
    name: 'Ana Prev',
    phone: '+385911110182',
    email: previousAddress,
  })
  const next = await createDriver(world.dispatcher, {
    ...driverBody,
    name: 'Iva Next',
    phone: '+385911110183',
    email: nextAddress,
  })
  const blank = await createDriver(world.dispatcher, {
    ...driverBody,
    name: 'Marko Blank',
    phone: '+385911110184',
  })
  const oldVehicle = await createVehicle(world.dispatcher, { ...vehicleBody('ZG9182AA'), description: 'Stari kombi' })
  const newVehicle = await createVehicle(world.dispatcher, { ...vehicleBody('ZG9182BB'), description: 'Novi kombi' })
  const recorded = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-15T22:30:00.000Z'),
    guestName,
    price: 42.5,
    payment: 'cash',
  })
  await assignRide(world.dispatcher, { rideId: recorded.ride.id, driverId: previous.id, vehicleId: oldVehicle.id })
  const logs = captureLogs()
  const sent: Array<{ to: string, subject: string, text: string }> = []
  const moved = await reassignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: next.id,
    vehicleId: newVehicle.id,
  }, {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder(mail) {
        sent.push(mail)
        if (mail.to === previousAddress)
          throw new Error(`rejected ${previousAddress} ${guestName}`)
      },
    },
  })
  expect(moved.ride).toMatchObject({ state: 'assigned', driverId: next.id, vehicleId: newVehicle.id })
  expect(moved.workOrders).toEqual([
    { driverId: next.id, outcome: 'sent' },
    { driverId: previous.id, outcome: 'failed' },
  ])
  expect(JSON.stringify(moved)).not.toContain(nextAddress)
  expect(JSON.stringify(moved)).not.toContain(previousAddress)
  expect(sent.map(mail => mail.to)).toEqual([nextAddress, previousAddress])
  expect(sent[0]?.subject.startsWith('Dodijeljeno ·')).toBe(true)
  expect(sent[0]?.text).toContain('Cijena: 42,50')
  expect(sent[0]?.text).toContain('Plaćanje: Gotovina')
  expect(sent[0]?.text).toContain('Registracija: ZG9182BB')
  expect(sent[1]?.text.startsWith('Više nije vaše\n')).toBe(true)
  expect(sent[1]?.text).toContain('Registracija: ZG9182AA')
  expect(sent[1]?.text).not.toContain('Cijena')
  expect(sent[1]?.text).not.toContain('42,50')
  expect(sent[1]?.text).not.toContain('Plaćanje')
  expect(await rideRow(recorded.ride.id)).toMatchObject({ driver_id: next.id, vehicle_id: newVehicle.id, state: 'assigned' })
  const audits = await changeAudits(world.tenantId)
  expect(audits.map(row => row.action)).toEqual(['ride.reassigned'])
  expect(JSON.stringify(audits)).not.toContain(nextAddress)
  expect(JSON.stringify(audits[0]?.data)).not.toContain(previous.id)

  const card = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-16T22:30:00.000Z'),
    guestName: 'Gost Kartica',
    price: 88,
    payment: 'card',
  })
  await assignRide(world.dispatcher, { rideId: card.ride.id, driverId: next.id, vehicleId: newVehicle.id })
  const cardSent: Array<{ to: string, text: string }> = []
  const cardMoved = await reassignRide(world.dispatcher, {
    rideId: card.ride.id,
    driverId: blank.id,
    vehicleId: oldVehicle.id,
  }, {
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder(mail) {
        cardSent.push(mail)
      },
    },
  })
  expect(cardMoved.workOrders).toEqual([
    { driverId: blank.id, outcome: 'no_email' },
    { driverId: next.id, outcome: 'sent' },
  ])
  expect(cardSent).toHaveLength(1)
  expect(cardSent[0]?.to).toBe(nextAddress)
  expect(cardSent[0]?.text.startsWith('Više nije vaše\n')).toBe(true)
  expect(cardSent[0]?.text).not.toContain('88')
  expect(cardSent[0]?.text).not.toContain('Gotovina')
  expect(cardSent[0]?.text).not.toContain('Plaćanje')

  const cleared = await clearRide(world.dispatcher, card.ride.id, {}, {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder() {
        throw new Error(`rejected ${previousAddress} ${guestName}`)
      },
    },
  })
  expect(cleared.ride).toMatchObject({ state: 'unassigned', driverId: null, vehicleId: null })
  expect(cleared.workOrders).toEqual([{ driverId: blank.id, outcome: 'no_email' }])
  expect(await rideRow(card.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, vehicle_id: null })

  const cashClear = await createTransfer(world.dispatcher, {
    ...transferBody(world, '2026-10-17T22:30:00.000Z'),
    guestName,
    price: 42.5,
    payment: 'cash',
  })
  await assignRide(world.dispatcher, { rideId: cashClear.ride.id, driverId: previous.id, vehicleId: oldVehicle.id })
  const clearedMail: Array<{ to: string, text: string }> = []
  const lost = await clearRide(world.dispatcher, cashClear.ride.id, {}, {
    logger: logs.logger,
    mailer: {
      async sendInvitation() {},
      async sendWorkOrder(mail) {
        clearedMail.push(mail)
        throw new Error(`rejected ${previousAddress} ${guestName}`)
      },
    },
  })
  expect(lost.workOrders).toEqual([{ driverId: previous.id, outcome: 'failed' }])
  expect(lost.ride.state).toBe('unassigned')
  expect(clearedMail[0]?.text.startsWith('Više nije vaše\n')).toBe(true)
  expect(clearedMail[0]?.text).toContain('Registracija: ZG9182AA')
  expect(clearedMail[0]?.text).not.toContain('Cijena')
  expect(clearedMail[0]?.text).not.toContain('42,50')
  expect(await rideRow(cashClear.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null })
  expect((await changeAudits(world.tenantId)).map(row => row.action)).toEqual(['ride.reassigned', 'ride.reassigned', 'ride.cleared', 'ride.cleared'])
  const failure = JSON.stringify(logs.lines())
  expect(failure).not.toContain(previousAddress)
  expect(failure).not.toContain(guestName)
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
  const ownRideForeignDriver = await call('GET', `/api/rides/${rideA.ride.id}/roster-vehicle?driverId=${driverB.id}`, firmA.dispatcher)
  expect(ownRideForeignDriver.status).toBe(404)
  expect(await ownRideForeignDriver.text()).not.toContain('+385911110088')
  expect(await rideRow(rideA.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null })
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
  expect(await assigned.json()).toMatchObject({ ride: { vehicleId: other.id, state: 'assigned' } })
})

it('pre-fills the roster Vehicle for the pickup local day, skips an archived one, and a roster change does not rewrite the Ride', async () => {
  const world = await office('hasg-prefill')
  const driver = await createDriver(world.dispatcher, driverBody)
  const beforeVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4001AA'))
  const afterVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4002AA'))
  const otherVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG4003AA'))
  const boundary = zagrebMidnightBoundary()
  const beforePickup = boundary.beforePickup
  const afterPickup = boundary.afterPickup
  const beforeDay = calendarDateInTimeZone('Europe/Zagreb', new Date(beforePickup))
  const afterDay = calendarDateInTimeZone('Europe/Zagreb', new Date(afterPickup))
  expect(beforeDay).toBe(boundary.previous)
  expect(afterDay).toBe(boundary.day)

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
  expect(await assigned.json()).toMatchObject({ ride: { vehicleId: otherVehicle.id } })

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
  expect(winner).toMatchObject({ ride: { state: 'assigned', driverId: driver.id } })
  expect([vehicle.id, other.id]).toContain(winner.ride.vehicleId)
  const row = await rideRow(recorded.ride.id)
  expect(row).toMatchObject({ state: 'assigned', driver_id: driver.id, vehicle_id: winner.ride.vehicleId })
  const audits = await assignmentAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  expect(audits[0]?.data.rideId).toBe(recorded.ride.id)
})

it('refuses a malformed driver or vehicle id, and a Ride that is not unassigned', async () => {
  const world = await office('hasg-shape')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG7001AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()))
  const path = `/api/rides/${recorded.ride.id}/assign`

  const badDriver = await call('POST', path, world.dispatcher, { driverId: 'not-a-driver', vehicleId: vehicle.id })
  expect(badDriver.status).toBe(400)
  expect(await badDriver.text()).not.toContain(phone)

  const badVehicle = await call('POST', path, world.dispatcher, { driverId: driver.id, vehicleId: 'not-a-vehicle' })
  expect(badVehicle.status).toBe(400)
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await assignmentAudits(world.tenantId)).toEqual([])

  // `cancelled` is a stored state this slice does not write. The check allows it with an open pair.
  const moved = await withAppTenant(world.tenantId, client => client.query(
    `update app.rides set state = 'cancelled' where id = $1 and state = 'unassigned'`,
    [recorded.ride.id],
  ))
  expect(moved.rowCount).toBe(1)
  const refused = await call('POST', path, world.dispatcher, { driverId: driver.id, vehicleId: vehicle.id })
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_not_unassigned')
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'cancelled',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await assignmentAudits(world.tenantId)).toEqual([])
})

it('refuses an assigned Ride that is missing a Driver, a Vehicle, or the must-accept copy', async () => {
  const world = await office('hasg-pair')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG7002AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString()))

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'assigned', driver_id = null, vehicle_id = $2, must_accept = false
     where id = $1`,
    [recorded.ride.id, vehicle.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_assigned_pair' })

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'assigned', driver_id = $2, vehicle_id = null, must_accept = false
     where id = $1`,
    [recorded.ride.id, driver.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_assigned_pair' })

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = null
     where id = $1`,
    [recorded.ride.id, driver.id, vehicle.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_assigned_pair' })

  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
})

it('stores an accepted Ride only with a Driver, a Vehicle, and must-accept true', async () => {
  const world = await office('hasg-acc')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG7003AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString()))

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'accepted', driver_id = null, vehicle_id = $2, must_accept = true
     where id = $1`,
    [recorded.ride.id, vehicle.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_accepted_pair' })

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'accepted', driver_id = $2, vehicle_id = null, must_accept = true
     where id = $1`,
    [recorded.ride.id, driver.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_accepted_pair' })

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'accepted', driver_id = $2, vehicle_id = $3, must_accept = false
     where id = $1`,
    [recorded.ride.id, driver.id, vehicle.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_accepted_pair' })

  await expect(withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'accepted', driver_id = $2, vehicle_id = $3, must_accept = null
     where id = $1`,
    [recorded.ride.id, driver.id, vehicle.id],
  ))).rejects.toMatchObject({ code: '23514', constraint: 'rides_accepted_pair' })

  const stored = await withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'accepted', driver_id = $2, vehicle_id = $3, must_accept = true
     where id = $1`,
    [recorded.ride.id, driver.id, vehicle.id],
  ))
  expect(stored.rowCount).toBe(1)
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
})

/**
 * Poll until another backend of this role is waiting on a share lock of `table`.
 * The holder stays open until this returns, so the assign result is the one
 * taken after that lock. A plain select would finish without waiting.
 */
async function waitForShareLock(table: 'app.drivers' | 'app.vehicles'): Promise<void> {
  const watcher = await appPool.connect()
  const deadline = Date.now() + 8_000
  try {
    while (Date.now() < deadline) {
      const waiting = await watcher.query(
        `select pid
         from pg_stat_activity
         where pid <> pg_backend_pid()
           and wait_event_type = 'Lock'
           and query ilike '%for share%'
           and query ilike $1`,
        [`%${table}%`],
      )
      if ((waiting.rowCount ?? 0) > 0)
        return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`assign did not wait on ${table} for share`)
  }
  finally {
    watcher.release()
  }
}

it('blocks on an open vehicle archive and then refuses the archived Vehicle', async () => {
  const world = await office('hasg-vlock')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG6001AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()))
  const holder = await appPool.connect()
  let pending: Promise<Response> | undefined
  try {
    await holder.query('begin')
    await holder.query('select set_config(\'app.tenant_id\', $1, true)', [world.tenantId])
    // The row lock archive takes, then the archive write, left uncommitted.
    const locked = await holder.query('select id from app.vehicles where id = $1 for update', [vehicle.id])
    expect(locked.rowCount).toBe(1)
    const archived = await holder.query('update app.vehicles set archived_at = now() where id = $1', [vehicle.id])
    expect(archived.rowCount).toBe(1)

    pending = call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: driver.id,
      vehicleId: vehicle.id,
    })
    await waitForShareLock('app.vehicles')
    await holder.query('commit')

    const response = await pending
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('ride_vehicle_archived')
    expect(await rideRow(recorded.ride.id)).toEqual({
      state: 'unassigned',
      driver_id: null,
      vehicle_id: null,
      must_accept: null,
    })
    expect(await assignmentAudits(world.tenantId)).toEqual([])
  }
  finally {
    await holder.query('rollback').catch(() => {})
    holder.release()
    await pending?.catch(() => {})
  }
})

it('blocks on an open must-accept correction and copies the committed value', async () => {
  const world = await office('hasg-dlock')
  const driver = await createDriver(world.dispatcher, driverBody)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG6002AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()))
  const holder = await appPool.connect()
  let pending: Promise<Response> | undefined
  try {
    await holder.query('begin')
    await holder.query('select set_config(\'app.tenant_id\', $1, true)', [world.tenantId])
    // The row lock a must-accept correction takes, then the new flag, left uncommitted.
    const locked = await holder.query('select id from app.drivers where id = $1 for update', [driver.id])
    expect(locked.rowCount).toBe(1)
    const corrected = await holder.query('update app.drivers set must_accept = true where id = $1', [driver.id])
    expect(corrected.rowCount).toBe(1)

    pending = call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: driver.id,
      vehicleId: vehicle.id,
    })
    await waitForShareLock('app.drivers')
    await holder.query('commit')

    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ride: { mustAccept: true, state: 'assigned' } })
    expect(await rideRow(recorded.ride.id)).toMatchObject({ must_accept: true, state: 'assigned' })
  }
  finally {
    await holder.query('rollback').catch(() => {})
    holder.release()
    await pending?.catch(() => {})
  }
})

it('assigns when the Driver licences and the Vehicle expiry dates are already past', async () => {
  const world = await office('hasg-expired')
  // A calendar day, not a pickup instant. Yesterday in the Tenant zone stays in the past.
  const expiredOn = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), -1)
  const driver = await createDriver(world.dispatcher, {
    ...driverBody,
    phone: '+385911110077',
    drivingLicenceExpiresOn: expiredOn,
    transportLicenceExpiresOn: expiredOn,
  })
  const vehicle = await createVehicle(world.dispatcher, {
    ...vehicleBody('ZG8001AA'),
    registrationExpiresOn: expiredOn,
    technicalInspectionExpiresOn: expiredOn,
    insuranceExpiresOn: expiredOn,
  })
  expect(driver).toMatchObject({
    drivingLicenceExpiresOn: expiredOn,
    transportLicenceExpiresOn: expiredOn,
    memberUserId: null,
  })
  expect(vehicle).toMatchObject({
    registrationExpiresOn: expiredOn,
    technicalInspectionExpiresOn: expiredOn,
    insuranceExpiresOn: expiredOn,
  })
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString()))

  const assigned = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toMatchObject({
    ride: {
      id: recorded.ride.id,
      state: 'assigned',
      driverId: driver.id,
      vehicleId: vehicle.id,
    },
    workOrders: [{ driverId: driver.id, outcome: 'no_email' }],
    relocationWarnings: [],
  })
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
  })
})

it('assigns a Driver with no linked account and copies must-accept', async () => {
  const world = await office('hasg-nolink')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110066' })
  expect(driver.memberUserId).toBeNull()
  const corrected = await updateDriver(world.admin, driver.id, { mustAccept: true })
  expect(corrected).toMatchObject({ memberUserId: null, mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8002AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString()))

  const assigned = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })
  expect(assigned.status).toBe(200)
  expect(await assigned.json()).toEqual({
    ride: {
      id: recorded.ride.id,
      transferId: recorded.transfer.id,
      state: 'assigned',
      driverId: driver.id,
      vehicleId: vehicle.id,
      mustAccept: true,
    },
    workOrders: [{ driverId: driver.id, outcome: 'no_email' }],
    relocationWarnings: [],
  })
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const linked = await ownerPool.query<{ member_user_id: string | null }>(
    'select member_user_id from app.drivers where id = $1',
    [driver.id],
  )
  expect(linked.rows).toEqual([{ member_user_id: null }])
})

async function acceptanceAudits(tenantId: string) {
  const result = await ownerPool.query<{
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string, fields?: string[] }
  }>(
    `select actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.accepted'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function linkedDriver(
  world: Awaited<ReturnType<typeof office>>,
  email: string,
  name: string,
  phoneNumber: string,
) {
  const userId = await addMember(world.tenantId, email, name, 'driver')
  const session = await signIn(email)
  const driver = await createDriver(world.dispatcher, {
    ...driverBody,
    name,
    phone: phoneNumber,
    memberUserId: userId,
  })
  return { userId, session, driver }
}

it('refuses an accept body that has a key before a session opens', async () => {
  const world = await office('hasg-acc-body')
  const linked = await linkedDriver(world, 'hasg-acc-body-driver@example.test', 'Drago Driver', phone)
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8101AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString()))
  const assigned = await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })
  expect(assigned.status).toBe(200)
  const before = await acceptanceAudits(world.tenantId)

  const keyed = await call('POST', `/api/rides/${recorded.ride.id}/accept`, undefined, { note: phone })
  expect(keyed.status).toBe(400)
  expect(await keyed.text()).not.toContain(phone)

  const keyedSession = await call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, { driverId: linked.driver.id })
  expect(keyedSession.status).toBe(400)
  expect(await keyedSession.text()).not.toContain(phone)

  expect((await call('POST', '/api/rides/not-a-ride/accept', linked.session, {})).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/accept`, undefined, {})).status).toBe(401)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect(await acceptanceAudits(world.tenantId)).toEqual(before)
})

it('lets the linked Driver accept, and refuses a dispatcher, an admin, and a second accept', async () => {
  const world = await office('hasg-acc-ok')
  const linked = await linkedDriver(world, 'hasg-acc-ok-driver@example.test', 'Drago Driver', phone)
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8102AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const path = `/api/rides/${recorded.ride.id}/accept`

  const dispatcher = await call('POST', path, world.dispatcher, {})
  expect(dispatcher.status).toBe(403)
  const admin = await call('POST', path, world.admin, {})
  expect(admin.status).toBe(403)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'assigned', must_accept: true })
  expect(await acceptanceAudits(world.tenantId)).toEqual([])

  const accepted = await call('POST', path, linked.session, {})
  expect(accepted.status).toBe(200)
  expect(await accepted.json()).toEqual({
    id: recorded.ride.id,
    transferId: recorded.transfer.id,
    state: 'accepted',
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const audits = await acceptanceAudits(world.tenantId)
  expect(audits).toEqual([{
    actor_user_id: linked.userId,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: linked.driver.id,
      fields: ['state'],
    },
  }])
  expect(JSON.stringify(audits[0]?.data)).not.toContain(phone)
  expect(JSON.stringify(audits[0]?.data)).not.toContain(guest)
  expect(JSON.stringify(audits[0]?.data)).not.toContain('ZG8102AA')

  const again = await call('POST', path, linked.session, {})
  expect(again.status).toBe(409)
  expect(await again.text()).toContain('ride_not_acceptable')
  expect(await acceptanceAudits(world.tenantId)).toHaveLength(1)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'accepted', driver_id: linked.driver.id })
})

it('refuses acceptance when the copied flag is off, when the Ride is not theirs, and from every other state', async () => {
  const world = await office('hasg-acc-state')
  const linked = await linkedDriver(world, 'hasg-acc-state-driver@example.test', 'Drago Driver', phone)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8103AA'))
  const pickup = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  const flaggedOff = await createTransfer(world.dispatcher, transferBody(world, pickup(13)))
  expect((await call('POST', `/api/rides/${flaggedOff.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const off = await call('POST', `/api/rides/${flaggedOff.ride.id}/accept`, linked.session, {})
  expect(off.status).toBe(409)
  expect(await off.text()).toContain('ride_not_acceptable')
  expect(await rideRow(flaggedOff.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })

  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const stillOff = await call('POST', `/api/rides/${flaggedOff.ride.id}/accept`, linked.session, {})
  expect(stillOff.status).toBe(409)
  expect(await rideRow(flaggedOff.ride.id)).toMatchObject({ state: 'assigned', must_accept: false })

  const open = await createTransfer(world.dispatcher, transferBody(world, pickup(14)))
  const unassigned = await call('POST', `/api/rides/${open.ride.id}/accept`, linked.session, {})
  expect(unassigned.status).toBe(404)
  const unassignedBody = await unassigned.text()
  expect(unassignedBody).not.toContain('ride_not_acceptable')
  expect(unassignedBody).not.toContain(guest)
  expect(await rideRow(open.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, must_accept: null })

  for (const [index, state] of (['done', 'no-show', 'cancelled', 'accepted'] as const).entries()) {
    const recorded = await createTransfer(world.dispatcher, transferBody(world, pickup(15 + index)))
    expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: linked.driver.id,
      vehicleId: vehicle.id,
    })).status).toBe(200)
    const moved = await withAppTenant(world.tenantId, client => client.query(
      `update app.rides set state = $2 where id = $1 and state = 'assigned'`,
      [recorded.ride.id, state],
    ))
    expect(moved.rowCount).toBe(1)
    const refused = await call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, {})
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('ride_not_acceptable')
    expect(await rideRow(recorded.ride.id)).toMatchObject({
      state,
      driver_id: linked.driver.id,
      vehicle_id: vehicle.id,
      must_accept: true,
    })
  }

  expect(await acceptanceAudits(world.tenantId)).toEqual([])
})

it('refuses another Driver, a Driver with no link, and another Tenant', async () => {
  const world = await office('hasg-acc-own')
  const otherFirm = await office('hasg-acc-own-b')
  const owner = await linkedDriver(world, 'hasg-acc-own-driver@example.test', 'Drago Driver', phone)
  const other = await linkedDriver(world, 'hasg-acc-own-other@example.test', 'Neda Neno', '+385911110077')
  const foreign = await linkedDriver(otherFirm, 'hasg-acc-own-b-driver@example.test', 'Boris Borić', '+385911110066')
  await updateDriver(world.admin, owner.driver.id, { mustAccept: true })
  await addMember(world.tenantId, 'hasg-acc-own-none@example.test', 'Lara Linkless', 'driver')
  const unlinked = await signIn('hasg-acc-own-none@example.test')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8104AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: owner.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const path = `/api/rides/${recorded.ride.id}/accept`

  const otherDriver = await call('POST', path, other.session, {})
  expect(otherDriver.status).toBe(404)
  expect(await otherDriver.text()).not.toContain(phone)

  const noLink = await call('POST', path, unlinked, {})
  expect(noLink.status).toBe(404)

  const foreignRide = await call('POST', path, foreign.session, {})
  expect(foreignRide.status).toBe(404)
  expect(await foreignRide.text()).not.toContain(phone)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: owner.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect(await acceptanceAudits(world.tenantId)).toEqual([])
  expect(await acceptanceAudits(otherFirm.tenantId)).toEqual([])
})

it('answers 404 when the Driver accepts a Ride that was cleared or reassigned, and writes nothing', async () => {
  const world = await office('hasg-acc-lost')
  const linked = await linkedDriver(world, 'hasg-acc-lost-driver@example.test', 'Drago Driver', phone)
  const other = await linkedDriver(world, 'hasg-acc-lost-other@example.test', 'Neda Neno', '+385911110077')
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  await updateDriver(world.admin, other.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8106AA'))
  const pickup = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  const cleared = await createTransfer(world.dispatcher, transferBody(world, pickup(34)))
  expect((await call('POST', `/api/rides/${cleared.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${cleared.ride.id}/clear`, world.dispatcher, {})).status).toBe(200)
  const afterClear = await call('POST', `/api/rides/${cleared.ride.id}/accept`, linked.session, {})
  expect(afterClear.status).toBe(404)
  const clearedBody = await afterClear.text()
  expect(clearedBody).not.toContain('ride_not_acceptable')
  expect(clearedBody).not.toContain(phone)
  expect(clearedBody).not.toContain(guest)
  expect(await rideRow(cleared.ride.id)).toMatchObject({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })

  const moved = await createTransfer(world.dispatcher, transferBody(world, pickup(35)))
  expect((await call('POST', `/api/rides/${moved.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${moved.ride.id}/reassign`, world.dispatcher, {
    driverId: other.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const afterReassign = await call('POST', `/api/rides/${moved.ride.id}/accept`, linked.session, {})
  expect(afterReassign.status).toBe(404)
  const reassignedBody = await afterReassign.text()
  expect(reassignedBody).not.toContain(phone)
  expect(reassignedBody).not.toContain(guest)
  expect(await rideRow(moved.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: other.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })

  expect(await acceptanceAudits(world.tenantId)).toEqual([])
})

it('lets exactly one of two concurrent accepts win', async () => {
  const world = await office('hasg-acc-race')
  const linked = await linkedDriver(world, 'hasg-acc-race-driver@example.test', 'Drago Driver', phone)
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8105AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 21 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const [first, second] = await Promise.all([
    call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, {}),
    call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, {}),
  ])
  const statuses = [first.status, second.status].sort()
  expect(statuses).toEqual([200, 409])
  const winner = first.status === 200 ? first : second
  expect(await winner.json()).toEqual({
    id: recorded.ride.id,
    transferId: recorded.transfer.id,
    state: 'accepted',
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const audits = await acceptanceAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  expect(audits[0]?.actor_user_id).toBe(linked.userId)
  expect(audits[0]?.data).toEqual({
    rideId: recorded.ride.id,
    driverId: linked.driver.id,
    fields: ['state'],
  })
})

async function phoneAcceptanceAudits(tenantId: string) {
  const result = await ownerPool.query<{
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string, fields?: string[] }
  }>(
    `select actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.accepted_by_phone'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function acceptanceRaceAudits(tenantId: string) {
  const result = await ownerPool.query<{
    action: string
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string, fields?: string[] }
  }>(
    `select action::text as action, actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text in ('ride.accepted', 'ride.accepted_by_phone')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

it('refuses an accept-by-phone body that has a key before a session opens', async () => {
  const world = await office('hasg-ph-body')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110088' })
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8201AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const path = `/api/rides/${recorded.ride.id}/accept-by-phone`
  const before = await phoneAcceptanceAudits(world.tenantId)

  const keyed = await call('POST', path, undefined, { note: phone })
  expect(keyed.status).toBe(400)
  expect(await keyed.text()).not.toContain(phone)

  const keyedSession = await call('POST', path, world.dispatcher, { driverId: driver.id })
  expect(keyedSession.status).toBe(400)
  expect(await keyedSession.text()).not.toContain(phone)

  expect((await call('POST', '/api/rides/not-a-ride/accept-by-phone', world.dispatcher, {})).status).toBe(400)
  expect((await call('POST', path, undefined, {})).status).toBe(401)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect(await phoneAcceptanceAudits(world.tenantId)).toEqual(before)
})

it('lets a dispatcher or an admin record acceptance by phone for a Driver with no account', async () => {
  const world = await office('hasg-ph-ok')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110088' })
  expect(driver.memberUserId).toBeNull()
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const linked = await linkedDriver(world, 'hasg-ph-ok-driver@example.test', 'Drago Driver', '+385911110077')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8202AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const path = `/api/rides/${recorded.ride.id}/accept-by-phone`

  const driverRole = await call('POST', path, linked.session, {})
  expect(driverRole.status).toBe(403)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'assigned', must_accept: true })
  expect(await phoneAcceptanceAudits(world.tenantId)).toEqual([])

  const accepted = await call('POST', path, world.dispatcher, {})
  expect(accepted.status).toBe(200)
  expect(await accepted.json()).toEqual({
    id: recorded.ride.id,
    transferId: recorded.transfer.id,
    state: 'accepted',
    driverId: driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const audits = await phoneAcceptanceAudits(world.tenantId)
  expect(audits).toEqual([{
    actor_user_id: world.dispatcherId,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: driver.id,
      fields: ['state'],
    },
  }])
  expect(JSON.stringify(audits[0]?.data)).not.toContain(phone)
  expect(JSON.stringify(audits[0]?.data)).not.toContain('+385911110088')
  expect(JSON.stringify(audits[0]?.data)).not.toContain(guest)
  expect(JSON.stringify(audits[0]?.data)).not.toContain('ZG8202AA')
  expect(JSON.stringify(audits[0]?.data)).not.toContain('mustAccept')
  expect(JSON.stringify(audits[0]?.data)).not.toContain(driver.name)

  const again = await call('POST', path, world.admin, {})
  expect(again.status).toBe(409)
  expect(await again.text()).toContain('ride_not_acceptable')
  expect(await phoneAcceptanceAudits(world.tenantId)).toHaveLength(1)

  const adminRide = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()))
  const adminVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8203AA'))
  expect((await call('POST', `/api/rides/${adminRide.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: adminVehicle.id,
  })).status).toBe(200)
  const byAdmin = await call('POST', `/api/rides/${adminRide.ride.id}/accept-by-phone`, world.admin, {})
  expect(byAdmin.status).toBe(200)
  expect(await rideRow(adminRide.ride.id)).toMatchObject({
    state: 'accepted',
    driver_id: driver.id,
    vehicle_id: adminVehicle.id,
    must_accept: true,
  })
  expect(await phoneAcceptanceAudits(world.tenantId)).toEqual([
    audits[0],
    {
      actor_user_id: world.adminUserId,
      subject_user_id: null,
      data: {
        rideId: adminRide.ride.id,
        driverId: driver.id,
        fields: ['state'],
      },
    },
  ])
})

it('refuses phone acceptance when the copied flag is off and from every state other than assigned', async () => {
  const world = await office('hasg-ph-state')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110088' })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8204AA'))
  const pickup = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  const flaggedOff = await createTransfer(world.dispatcher, transferBody(world, pickup(25)))
  expect((await call('POST', `/api/rides/${flaggedOff.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const off = await call('POST', `/api/rides/${flaggedOff.ride.id}/accept-by-phone`, world.dispatcher, {})
  expect(off.status).toBe(409)
  expect(await off.text()).toContain('ride_not_acceptable')
  expect(await rideRow(flaggedOff.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })

  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const stillOff = await call('POST', `/api/rides/${flaggedOff.ride.id}/accept-by-phone`, world.dispatcher, {})
  expect(stillOff.status).toBe(409)
  expect(await rideRow(flaggedOff.ride.id)).toMatchObject({ state: 'assigned', must_accept: false })

  const open = await createTransfer(world.dispatcher, transferBody(world, pickup(26)))
  const unassigned = await call('POST', `/api/rides/${open.ride.id}/accept-by-phone`, world.admin, {})
  expect(unassigned.status).toBe(409)
  expect(await unassigned.text()).toContain('ride_not_acceptable')
  expect(await rideRow(open.ride.id)).toMatchObject({ state: 'unassigned', driver_id: null, must_accept: null })

  for (const [index, state] of (['done', 'no-show', 'cancelled', 'accepted'] as const).entries()) {
    const recorded = await createTransfer(world.dispatcher, transferBody(world, pickup(27 + index)))
    expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: driver.id,
      vehicleId: vehicle.id,
    })).status).toBe(200)
    const moved = await withAppTenant(world.tenantId, client => client.query(
      `update app.rides set state = $2 where id = $1 and state = 'assigned'`,
      [recorded.ride.id, state],
    ))
    expect(moved.rowCount).toBe(1)
    const refused = await call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, world.dispatcher, {})
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('ride_not_acceptable')
    expect(await rideRow(recorded.ride.id)).toMatchObject({
      state,
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      must_accept: true,
    })
  }

  expect(await phoneAcceptanceAudits(world.tenantId)).toEqual([])
})

it('hides another Tenant\'s Ride from phone acceptance and writes no audit row', async () => {
  const world = await office('hasg-ph-own')
  const otherFirm = await office('hasg-ph-own-b')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110088' })
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8205AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const foreign = await call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, otherFirm.dispatcher, {})
  expect(foreign.status).toBe(404)
  expect(await foreign.text()).not.toContain(phone)
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect(await phoneAcceptanceAudits(world.tenantId)).toEqual([])
  expect(await phoneAcceptanceAudits(otherFirm.tenantId)).toEqual([])
})

it('lets exactly one of an office accept and a Driver accept win', async () => {
  const world = await office('hasg-ph-race')
  const linked = await linkedDriver(world, 'hasg-ph-race-driver@example.test', 'Drago Driver', '+385911110088')
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8206AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 33 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const [officeResult, driverResult] = await Promise.all([
    call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, world.dispatcher, {}),
    call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, {}),
  ])
  const statuses = [officeResult.status, driverResult.status].sort()
  expect(statuses).toEqual([200, 409])
  const winner = officeResult.status === 200 ? officeResult : driverResult
  expect(await winner.json()).toEqual({
    id: recorded.ride.id,
    transferId: recorded.transfer.id,
    state: 'accepted',
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const audits = await acceptanceRaceAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  const expectedActor = officeResult.status === 200 ? world.dispatcherId : linked.userId
  const expectedAction = officeResult.status === 200 ? 'ride.accepted_by_phone' : 'ride.accepted'
  expect(audits[0]).toEqual({
    action: expectedAction,
    actor_user_id: expectedActor,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: linked.driver.id,
      fields: ['state'],
    },
  })
  expect(JSON.stringify(audits[0]?.data)).not.toContain('+385911110088')
})

it('lets exactly one of two office accepts win', async () => {
  const world = await office('hasg-ph-race2')
  const driver = await createDriver(world.dispatcher, { ...driverBody, phone: '+385911110088' })
  expect(driver.memberUserId).toBeNull()
  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8207AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 34 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const [first, second] = await Promise.all([
    call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, world.dispatcher, {}),
    call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, world.admin, {}),
  ])
  const statuses = [first.status, second.status].sort()
  expect(statuses).toEqual([200, 409])
  const winner = first.status === 200 ? first : second
  expect(await winner.json()).toEqual({
    id: recorded.ride.id,
    transferId: recorded.transfer.id,
    state: 'accepted',
    driverId: driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  const audits = await phoneAcceptanceAudits(world.tenantId)
  expect(audits).toHaveLength(1)
  const expectedActor = first.status === 200 ? world.dispatcherId : world.adminUserId
  expect(audits[0]?.actor_user_id).toBe(expectedActor)
  expect(audits[0]?.subject_user_id).toBeNull()
  expect(audits[0]?.data).toEqual({
    rideId: recorded.ride.id,
    driverId: driver.id,
    fields: ['state'],
  })
  expect(await acceptanceAudits(world.tenantId)).toEqual([])
})

async function changeAudits(tenantId: string) {
  const result = await ownerPool.query<{
    action: string
    actor_user_id: string
    subject_user_id: string | null
    data: unknown
  }>(
    `select action::text as action, actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text in ('ride.vehicle_changed', 'ride.cleared', 'ride.reassigned')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

it('changes the vehicle, reassigns, and clears, and a driver is refused with no transition', async () => {
  const world = await office('hasg-chg')
  const first = await linkedDriver(world, 'hasg-chg-a@example.test', 'Ana Prva', '+385911110071')
  const second = await linkedDriver(world, 'hasg-chg-b@example.test', 'Iva Druga', '+385911110072')
  await updateDriver(world.admin, first.driver.id, { mustAccept: true })
  await updateDriver(world.admin, second.driver.id, { mustAccept: false })
  const kept = await createVehicle(world.dispatcher, vehicleBody('ZG8301AA'))
  const next = await createVehicle(world.dispatcher, vehicleBody('ZG8302AA'))
  const archived = await createVehicle(world.dispatcher, vehicleBody('ZG8303AA'))
  await archiveVehicle(world.dispatcher, archived.id)
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: first.driver.id,
    vehicleId: kept.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/accept-by-phone`, world.dispatcher, {})).status).toBe(200)

  const driverVehicle = await call('POST', `/api/rides/${recorded.ride.id}/vehicle`, first.session, { vehicleId: next.id })
  expect(driverVehicle.status).toBe(403)
  const driverClear = await call('POST', `/api/rides/${recorded.ride.id}/clear`, first.session, {})
  expect(driverClear.status).toBe(403)
  const driverReassign = await call('POST', `/api/rides/${recorded.ride.id}/reassign`, first.session, {
    driverId: second.driver.id,
    vehicleId: next.id,
  })
  expect(driverReassign.status).toBe(403)
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'accepted',
    driver_id: first.driver.id,
    vehicle_id: kept.id,
    must_accept: true,
  })
  expect(await changeAudits(world.tenantId)).toEqual([])
  expect((await listUpcomingRides(first.session)).rides.map(ride => ride.rideId)).toContain(recorded.ride.id)

  const sameVehicle = await call('POST', `/api/rides/${recorded.ride.id}/vehicle`, world.dispatcher, { vehicleId: kept.id })
  expect(sameVehicle.status).toBe(409)
  expect(await sameVehicle.text()).toContain('ride_vehicle_unchanged')
  expect(await changeAudits(world.tenantId)).toEqual([])

  const archivedVehicle = await call('POST', `/api/rides/${recorded.ride.id}/vehicle`, world.dispatcher, { vehicleId: archived.id })
  expect(archivedVehicle.status).toBe(409)
  expect(await archivedVehicle.text()).toContain('ride_vehicle_archived')
  expect(await rideRow(recorded.ride.id)).toMatchObject({ vehicle_id: kept.id, state: 'accepted', must_accept: true })

  const changed = await call('POST', `/api/rides/${recorded.ride.id}/vehicle`, world.dispatcher, { vehicleId: next.id })
  expect(changed.status).toBe(200)
  const changedBody = await changed.json()
  expect(changedBody).toEqual({
    ride: {
      id: recorded.ride.id,
      transferId: recorded.transfer.id,
      state: 'accepted',
      driverId: first.driver.id,
      vehicleId: next.id,
      mustAccept: true,
    },
    workOrders: [{ driverId: first.driver.id, outcome: 'sent' }],
    relocationWarnings: [],
  })
  expect(JSON.stringify(changedBody)).not.toContain('hasg-chg-a@example.test')

  const sameDriver = await call('POST', `/api/rides/${recorded.ride.id}/reassign`, world.dispatcher, {
    driverId: first.driver.id,
    vehicleId: kept.id,
  })
  expect(sameDriver.status).toBe(409)
  expect(await sameDriver.text()).toContain('ride_same_driver')
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'accepted', driver_id: first.driver.id, must_accept: true })

  const moved = await call('POST', `/api/rides/${recorded.ride.id}/reassign`, world.admin, {
    driverId: second.driver.id,
    vehicleId: kept.id,
  })
  expect(moved.status).toBe(200)
  expect(await moved.json()).toEqual({
    ride: {
      id: recorded.ride.id,
      transferId: recorded.transfer.id,
      state: 'assigned',
      driverId: second.driver.id,
      vehicleId: kept.id,
      mustAccept: false,
    },
    workOrders: [
      { driverId: second.driver.id, outcome: 'sent' },
      { driverId: first.driver.id, outcome: 'sent' },
    ],
    relocationWarnings: [],
  })
  expect((await listUpcomingRides(first.session)).rides.map(ride => ride.rideId)).not.toContain(recorded.ride.id)
  expect((await listUpcomingRides(second.session)).rides.map(ride => ride.rideId)).toContain(recorded.ride.id)

  const cleared = await call('POST', `/api/rides/${recorded.ride.id}/clear`, world.dispatcher, {})
  expect(cleared.status).toBe(200)
  expect(await cleared.json()).toEqual({
    ride: {
      id: recorded.ride.id,
      transferId: recorded.transfer.id,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
    },
    workOrders: [{ driverId: second.driver.id, outcome: 'sent' }],
    relocationWarnings: [],
  })
  expect((await listUpcomingRides(second.session)).rides.map(ride => ride.rideId)).not.toContain(recorded.ride.id)

  const again = await call('POST', `/api/rides/${recorded.ride.id}/clear`, world.dispatcher, {})
  expect(again.status).toBe(409)
  expect(await again.text()).toContain('ride_not_open')
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })

  const audits = await changeAudits(world.tenantId)
  expect(audits.map(row => row.action)).toEqual(['ride.vehicle_changed', 'ride.reassigned', 'ride.cleared'])
  expect(audits[0]).toMatchObject({
    actor_user_id: world.dispatcherId,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: first.driver.id,
      vehicleId: next.id,
      fields: ['vehicleId'],
    },
  })
  expect(audits[1]).toMatchObject({
    actor_user_id: world.adminUserId,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: second.driver.id,
      vehicleId: kept.id,
      fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
    },
  })
  expect(audits[2]).toMatchObject({
    actor_user_id: world.dispatcherId,
    subject_user_id: null,
    data: {
      rideId: recorded.ride.id,
      driverId: second.driver.id,
      vehicleId: kept.id,
      fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
    },
  })
  const stored = JSON.stringify(audits)
  expect(stored).not.toContain('+385911110071')
  expect(stored).not.toContain('ZG8301AA')
  expect(stored).not.toContain(guest)

  const other = await office('hasg-chg-b')
  const foreign = await call('POST', `/api/rides/${recorded.ride.id}/vehicle`, other.dispatcher, { vehicleId: next.id })
  expect(foreign.status).toBe(404)
  expect(await changeAudits(other.tenantId)).toEqual([])
})

async function doneAudits(tenantId: string) {
  const result = await ownerPool.query<{
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string, fields?: string[] }
  }>(
    `select actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.done'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

it('refuses a done body that has a key before a session opens', async () => {
  const world = await office('hasg-done-body')
  const linked = await linkedDriver(world, 'hasg-done-body-driver@example.test', 'Drago Driver', phone)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8401AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const before = await doneAudits(world.tenantId)

  const keyed = await call('POST', `/api/rides/${recorded.ride.id}/done`, undefined, { note: phone })
  expect(keyed.status).toBe(400)
  expect(await keyed.text()).not.toContain(phone)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/done`, linked.session, { guestName: guest })).status).toBe(400)
  expect((await call('POST', '/api/rides/not-a-ride/done', linked.session, {})).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/done`, undefined, {})).status).toBe(401)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })
  expect(await doneAudits(world.tenantId)).toEqual(before)
})

it('lets the Driver and the office mark done from assigned when the copied flag is off', async () => {
  const world = await office('hasg-done-off')
  const linked = await linkedDriver(world, 'hasg-done-off-driver@example.test', 'Drago Driver', phone)
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8402AA'))
  const byDriver = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 21 * 60 * 60 * 1000).toISOString()))
  const byOffice = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString()))
  for (const recorded of [byDriver, byOffice]) {
    expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: linked.driver.id,
      vehicleId: vehicle.id,
    })).status).toBe(200)
  }

  const driverDone = await call('POST', `/api/rides/${byDriver.ride.id}/done`, linked.session, {})
  expect(driverDone.status).toBe(200)
  expect(await driverDone.json()).toEqual({
    id: byDriver.ride.id,
    transferId: byDriver.transfer.id,
    state: 'done',
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
    mustAccept: false,
  })

  const officeDone = await call('POST', `/api/rides/${byOffice.ride.id}/done`, world.dispatcher, {})
  expect(officeDone.status).toBe(200)
  expect(await officeDone.json()).toMatchObject({ state: 'done', mustAccept: false, driverId: linked.driver.id })

  const upcoming = await listUpcomingRides(linked.session)
  expect(upcoming.rides.map(ride => ride.rideId)).not.toContain(byDriver.ride.id)
  expect(upcoming.rides.map(ride => ride.rideId)).not.toContain(byOffice.ride.id)

  const audits = await doneAudits(world.tenantId)
  expect(audits).toEqual([
    {
      actor_user_id: linked.userId,
      subject_user_id: null,
      data: { rideId: byDriver.ride.id, driverId: linked.driver.id, fields: ['state'] },
    },
    {
      actor_user_id: world.dispatcherId,
      subject_user_id: null,
      data: { rideId: byOffice.ride.id, driverId: linked.driver.id, fields: ['state'] },
    },
  ])
  const stored = JSON.stringify(audits)
  expect(stored).not.toContain(phone)
  expect(stored).not.toContain('ZG8402AA')
  expect(stored).not.toContain(guest)
})

it('refuses done from assigned when the flag is on, and allows it from accepted for the Driver and the office', async () => {
  const world = await office('hasg-done-on')
  const linked = await linkedDriver(world, 'hasg-done-on-driver@example.test', 'Drago Driver', '+385911110841')
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8403AA'))
  const driverRide = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()))
  const officeRide = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()))
  for (const recorded of [driverRide, officeRide]) {
    expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: linked.driver.id,
      vehicleId: vehicle.id,
    })).status).toBe(200)
  }

  const driverEarly = await call('POST', `/api/rides/${driverRide.ride.id}/done`, linked.session, {})
  expect(driverEarly.status).toBe(409)
  expect(await driverEarly.text()).toContain('ride_not_finishable')
  const officeEarly = await call('POST', `/api/rides/${officeRide.ride.id}/done`, world.admin, {})
  expect(officeEarly.status).toBe(409)
  expect(await rideRow(driverRide.ride.id)).toMatchObject({ state: 'assigned', must_accept: true })
  expect(await rideRow(officeRide.ride.id)).toMatchObject({ state: 'assigned', must_accept: true })
  expect(await doneAudits(world.tenantId)).toEqual([])

  expect((await call('POST', `/api/rides/${driverRide.ride.id}/accept`, linked.session, {})).status).toBe(200)
  expect((await call('POST', `/api/rides/${officeRide.ride.id}/accept-by-phone`, world.dispatcher, {})).status).toBe(200)

  const driverDone = await call('POST', `/api/rides/${driverRide.ride.id}/done`, linked.session, {})
  expect(driverDone.status).toBe(200)
  expect(await driverDone.json()).toMatchObject({ state: 'done', mustAccept: true })
  const officeDone = await call('POST', `/api/rides/${officeRide.ride.id}/done`, world.admin, {})
  expect(officeDone.status).toBe(200)
  expect(await officeDone.json()).toMatchObject({ state: 'done', mustAccept: true })
  expect((await doneAudits(world.tenantId)).map(row => row.actor_user_id)).toEqual([
    linked.userId,
    world.adminUserId,
  ])
})

it('refuses done from unassigned and from a terminal Ride, and writes no transition', async () => {
  const world = await office('hasg-done-closed')
  const linked = await linkedDriver(world, 'hasg-done-closed-driver@example.test', 'Drago Driver', '+385911110842')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8404AA'))
  const open = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()))
  const finished = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${finished.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${finished.ride.id}/done`, linked.session, {})).status).toBe(200)

  const unassignedOffice = await call('POST', `/api/rides/${open.ride.id}/done`, world.dispatcher, {})
  expect(unassignedOffice.status).toBe(409)
  const unassignedDriver = await call('POST', `/api/rides/${open.ride.id}/done`, linked.session, {})
  expect(unassignedDriver.status).toBe(404)
  expect(await rideRow(open.ride.id)).toMatchObject({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })

  const again = await call('POST', `/api/rides/${finished.ride.id}/done`, world.dispatcher, {})
  expect(again.status).toBe(409)
  const accepted = await call('POST', `/api/rides/${finished.ride.id}/accept`, linked.session, {})
  expect(accepted.status).toBe(409)
  expect(await rideRow(finished.ride.id)).toMatchObject({ state: 'done', must_accept: false })
  expect(await doneAudits(world.tenantId)).toHaveLength(1)

  await ownerPool.query(`update app.rides set state = 'no-show' where id = $1`, [finished.ride.id])
  expect((await call('POST', `/api/rides/${finished.ride.id}/done`, world.admin, {})).status).toBe(409)
  expect(await rideRow(finished.ride.id)).toMatchObject({ state: 'no-show' })
  await ownerPool.query(`update app.rides set state = 'cancelled' where id = $1`, [finished.ride.id])
  expect((await call('POST', `/api/rides/${finished.ride.id}/done`, world.admin, {})).status).toBe(409)
  expect(await rideRow(finished.ride.id)).toMatchObject({ state: 'cancelled' })
  expect(await doneAudits(world.tenantId)).toHaveLength(1)
})

it('hides another Driver and another Tenant, and lets the office mark a Driver with no account', async () => {
  const world = await office('hasg-done-hide')
  const linked = await linkedDriver(world, 'hasg-done-hide-driver@example.test', 'Drago Driver', '+385911110843')
  const other = await linkedDriver(world, 'hasg-done-hide-other@example.test', 'Iva Other', '+385911110844')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8405AA'))
  const held = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 27 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${held.ride.id}/assign`, world.dispatcher, {
    driverId: other.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const stolen = await call('POST', `/api/rides/${held.ride.id}/done`, linked.session, {})
  expect(stolen.status).toBe(404)
  expect(await rideRow(held.ride.id)).toMatchObject({ state: 'assigned', driver_id: other.driver.id })

  const foreignWorld = await office('hasg-done-foreign')
  expect((await call('POST', `/api/rides/${held.ride.id}/done`, foreignWorld.dispatcher, {})).status).toBe(404)
  expect(await doneAudits(world.tenantId)).toEqual([])
  expect(await doneAudits(foreignWorld.tenantId)).toEqual([])

  const noAccount = await createDriver(world.dispatcher, { ...driverBody, name: 'Bez računa', phone: '+385911110845' })
  const quiet = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 28 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${quiet.ride.id}/assign`, world.dispatcher, {
    driverId: noAccount.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  const marked = await call('POST', `/api/rides/${quiet.ride.id}/done`, world.dispatcher, {})
  expect(marked.status).toBe(200)
  expect(await marked.json()).toMatchObject({ state: 'done', driverId: noAccount.id, mustAccept: false })
  expect(await doneAudits(world.tenantId)).toEqual([{
    actor_user_id: world.dispatcherId,
    subject_user_id: null,
    data: { rideId: quiet.ride.id, driverId: noAccount.id, fields: ['state'] },
  }])
})

async function cancelAudits(tenantId: string) {
  const result = await ownerPool.query<{
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string | null, fields?: string[] }
  }>(
    `select actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.cancelled'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

it('refuses a cancel body that has a key before a session opens', async () => {
  const world = await office('hasg-cancel-body')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 29 * 60 * 60 * 1000).toISOString()))
  const before = await cancelAudits(world.tenantId)

  const keyed = await call('POST', `/api/rides/${recorded.ride.id}/cancel`, undefined, { note: phone })
  expect(keyed.status).toBe(400)
  expect(await keyed.text()).not.toContain(phone)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/cancel`, world.dispatcher, { guestName: guest })).status).toBe(400)
  expect((await call('POST', '/api/rides/not-a-ride/cancel', world.dispatcher, {})).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/cancel`, undefined, {})).status).toBe(401)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(await cancelAudits(world.tenantId)).toEqual(before)
})

it('lets a dispatcher or an admin cancel from unassigned, assigned, and accepted, and the Ride leaves the upcoming list', async () => {
  const world = await office('hasg-cancel-open')
  const linked = await linkedDriver(world, 'hasg-cancel-open-driver@example.test', 'Drago Driver', '+385911110850')
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8501AA'))
  const open = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString()))
  const assigned = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 31 * 60 * 60 * 1000).toISOString()))
  const accepted = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString()))
  for (const recorded of [assigned, accepted]) {
    expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
      driverId: linked.driver.id,
      vehicleId: vehicle.id,
    })).status).toBe(200)
  }
  expect((await call('POST', `/api/rides/${accepted.ride.id}/accept`, linked.session, {})).status).toBe(200)
  expect((await listUpcomingRides(linked.session)).rides.map(ride => ride.rideId)).toEqual([
    assigned.ride.id,
    accepted.ride.id,
  ])

  const openCancel = await call('POST', `/api/rides/${open.ride.id}/cancel`, world.dispatcher, {})
  expect(openCancel.status).toBe(200)
  expect(await openCancel.json()).toEqual({
    id: open.ride.id,
    transferId: open.transfer.id,
    state: 'cancelled',
    driverId: null,
    vehicleId: null,
    mustAccept: null,
  })

  const assignedCancel = await call('POST', `/api/rides/${assigned.ride.id}/cancel`, world.admin, {})
  expect(assignedCancel.status).toBe(200)
  expect(await assignedCancel.json()).toMatchObject({
    state: 'cancelled',
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
    mustAccept: true,
  })

  const acceptedCancel = await call('POST', `/api/rides/${accepted.ride.id}/cancel`, world.dispatcher, {})
  expect(acceptedCancel.status).toBe(200)
  expect(await rideRow(accepted.ride.id)).toMatchObject({
    state: 'cancelled',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect((await listUpcomingRides(linked.session)).rides).toEqual([])

  const audits = await cancelAudits(world.tenantId)
  expect(audits).toEqual([
    {
      actor_user_id: world.dispatcherId,
      subject_user_id: null,
      data: { rideId: open.ride.id, driverId: null, fields: ['state'] },
    },
    {
      actor_user_id: world.adminUserId,
      subject_user_id: null,
      data: { rideId: assigned.ride.id, driverId: linked.driver.id, fields: ['state'] },
    },
    {
      actor_user_id: world.dispatcherId,
      subject_user_id: null,
      data: { rideId: accepted.ride.id, driverId: linked.driver.id, fields: ['state'] },
    },
  ])
  const stored = JSON.stringify(audits)
  expect(stored).not.toContain('+385911110850')
  expect(stored).not.toContain('ZG8501AA')
  expect(stored).not.toContain(guest)
})

it('refuses a driver, a terminal Ride, and a further transition, and writes no cancel', async () => {
  const world = await office('hasg-cancel-closed')
  const linked = await linkedDriver(world, 'hasg-cancel-closed-driver@example.test', 'Drago Driver', '+385911110851')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8502AA'))
  const other = await createVehicle(world.dispatcher, vehicleBody('ZG8503AA'))
  const held = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 33 * 60 * 60 * 1000).toISOString()))
  const finished = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 34 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${held.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${finished.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${finished.ride.id}/done`, linked.session, {})).status).toBe(200)

  const driverCancel = await call('POST', `/api/rides/${held.ride.id}/cancel`, linked.session, {})
  expect(driverCancel.status).toBe(403)
  expect(await rideRow(held.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })
  expect(await cancelAudits(world.tenantId)).toEqual([])

  const doneCancel = await call('POST', `/api/rides/${finished.ride.id}/cancel`, world.dispatcher, {})
  expect(doneCancel.status).toBe(409)
  expect(await doneCancel.text()).toContain('ride_not_cancellable')
  expect(await rideRow(finished.ride.id)).toMatchObject({ state: 'done' })

  await ownerPool.query(`update app.rides set state = 'no-show' where id = $1`, [finished.ride.id])
  expect((await call('POST', `/api/rides/${finished.ride.id}/cancel`, world.admin, {})).status).toBe(409)
  expect(await rideRow(finished.ride.id)).toMatchObject({ state: 'no-show' })
  expect(await cancelAudits(world.tenantId)).toEqual([])

  const cancelled = await call('POST', `/api/rides/${held.ride.id}/cancel`, world.dispatcher, {})
  expect(cancelled.status).toBe(200)
  const again = await call('POST', `/api/rides/${held.ride.id}/cancel`, world.admin, {})
  expect(again.status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/accept`, linked.session, {})).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/accept-by-phone`, world.dispatcher, {})).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/done`, world.dispatcher, {})).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/clear`, world.dispatcher, {})).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/vehicle`, world.dispatcher, { vehicleId: other.id })).status).toBe(409)
  expect((await call('POST', `/api/rides/${held.ride.id}/reassign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(409)
  expect(await rideRow(held.ride.id)).toMatchObject({
    state: 'cancelled',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })
  expect(await cancelAudits(world.tenantId)).toHaveLength(1)
  await expect(withAppTenant(world.tenantId, client => client.query('delete from app.rides'))).rejects.toMatchObject({ code: '42501' })
  expect(await rideRow(held.ride.id)).toMatchObject({ state: 'cancelled' })
})

it('hides another Tenant from cancel and writes no audit row', async () => {
  const world = await office('hasg-cancel-hide')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 35 * 60 * 60 * 1000).toISOString()))
  const foreign = await office('hasg-cancel-foreign')
  expect((await call('POST', `/api/rides/${recorded.ride.id}/cancel`, foreign.dispatcher, {})).status).toBe(404)
  expect((await call('POST', `/api/rides/${crypto.randomUUID()}/cancel`, world.admin, {})).status).toBe(404)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'unassigned' })
  expect(await cancelAudits(world.tenantId)).toEqual([])
  expect(await cancelAudits(foreign.tenantId)).toEqual([])
})

async function declineAudits(tenantId: string) {
  const result = await ownerPool.query<{
    actor_user_id: string
    subject_user_id: string | null
    data: { rideId?: string, driverId?: string, vehicleId?: string, fields?: string[] }
  }>(
    `select actor_user_id, subject_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text = 'ride.declined'
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function declineAlertRows(tenantId: string) {
  const result = await ownerPool.query<{ ride_id: string, driver_id: string, kind: string }>(
    `select ride_id, driver_id, kind from app.ride_alert where tenant_id = $1 order by created_at, id`,
    [tenantId],
  )
  return result.rows
}

it('refuses a decline body that has a key before a session opens', async () => {
  const world = await office('hasg-dec-body')
  const linked = await linkedDriver(world, 'hasg-dec-body-driver@example.test', 'Drago Driver', '+385911110851')
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8501AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)

  const keyed = await call('POST', `/api/rides/${recorded.ride.id}/decline`, undefined, { note: phone })
  expect(keyed.status).toBe(400)
  expect(await keyed.text()).not.toContain(phone)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/decline`, linked.session, { guestName: guest })).status).toBe(400)
  expect((await call('POST', '/api/rides/not-a-ride/decline', linked.session, {})).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/decline`, undefined, {})).status).toBe(401)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/decline`, world.dispatcher, {})).status).toBe(403)

  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'assigned',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: false,
  })
  expect(await declineAudits(world.tenantId)).toEqual([])
  expect(await declineAlertRows(world.tenantId)).toEqual([])
})

it('declines an assigned Ride, with the copied flag off or on, and the board names that Driver', async () => {
  const world = await office('hasg-dec-off')
  const linked = await linkedDriver(world, 'hasg-dec-off-driver@example.test', 'Drago Driver', '+385911110852')
  const must = await linkedDriver(world, 'hasg-dec-on-driver@example.test', 'Nika Vozač', '+385911110853')
  await updateDriver(world.admin, must.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8502AA'))
  const otherVehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8502BB'))
  const day = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 4)
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const plain = await createTransfer(world.dispatcher, transferBody(world, pickupAt))
  const waiting = await createTransfer(world.dispatcher, { ...transferBody(world, pickupAt), guestName: 'Ivo Ivić' })
  expect((await call('POST', `/api/rides/${plain.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${waiting.ride.id}/assign`, world.dispatcher, {
    driverId: must.driver.id,
    vehicleId: otherVehicle.id,
  })).status).toBe(200)

  const declined = await call('POST', `/api/rides/${plain.ride.id}/decline`, linked.session, {})
  expect(declined.status).toBe(200)
  expect(await declined.json()).toEqual({
    id: plain.ride.id,
    transferId: plain.transfer.id,
    state: 'unassigned',
    driverId: null,
    vehicleId: null,
    mustAccept: null,
  })
  const waitingDeclined = await call('POST', `/api/rides/${waiting.ride.id}/decline`, must.session, {})
  expect(waitingDeclined.status).toBe(200)
  expect(await waitingDeclined.json()).toMatchObject({ state: 'unassigned', driverId: null, vehicleId: null, mustAccept: null })

  expect((await listUpcomingRides(linked.session)).rides.map(ride => ride.rideId)).not.toContain(plain.ride.id)
  expect((await listUpcomingRides(must.session)).rides.map(ride => ride.rideId)).not.toContain(waiting.ride.id)

  const dayList = await listTransferDay(world.dispatcher, day)
  expect(dayList.declineAlerts.map(alert => ({
    rideId: alert.rideId,
    driverId: alert.driverId,
    driverName: alert.driverName,
    guestName: alert.guestName,
  }))).toEqual([
    {
      rideId: plain.ride.id,
      driverId: linked.driver.id,
      driverName: 'Drago Driver',
      guestName: guest,
    },
    {
      rideId: waiting.ride.id,
      driverId: must.driver.id,
      driverName: 'Nika Vozač',
      guestName: 'Ivo Ivić',
    },
  ])

  const audits = await declineAudits(world.tenantId)
  expect(audits).toEqual([
    {
      actor_user_id: linked.userId,
      subject_user_id: null,
      data: {
        rideId: plain.ride.id,
        driverId: linked.driver.id,
        vehicleId: vehicle.id,
        fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
      },
    },
    {
      actor_user_id: must.userId,
      subject_user_id: null,
      data: {
        rideId: waiting.ride.id,
        driverId: must.driver.id,
        vehicleId: otherVehicle.id,
        fields: ['state', 'driverId', 'vehicleId', 'mustAccept'],
      },
    },
  ])
  const stored = JSON.stringify(audits)
  expect(stored).not.toContain('+385911110852')
  expect(stored).not.toContain('ZG8502AA')
  expect(stored).not.toContain('ZG8502BB')
  expect(stored).not.toContain(guest)
  expect(stored).not.toContain('Ivo Ivić')
  expect(await declineAlertRows(world.tenantId)).toEqual([
    { ride_id: plain.ride.id, driver_id: linked.driver.id, kind: 'declined' },
    { ride_id: waiting.ride.id, driver_id: must.driver.id, kind: 'declined' },
  ])
})

it('refuses a decline from accepted and writes no transition', async () => {
  const world = await office('hasg-dec-acc')
  const linked = await linkedDriver(world, 'hasg-dec-acc-driver@example.test', 'Drago Driver', '+385911110854')
  await updateDriver(world.admin, linked.driver.id, { mustAccept: true })
  const vehicle = await createVehicle(world.dispatcher, vehicleBody('ZG8503AA'))
  const recorded = await createTransfer(world.dispatcher, transferBody(world, new Date(Date.now() + 31 * 60 * 60 * 1000).toISOString()))
  expect((await call('POST', `/api/rides/${recorded.ride.id}/assign`, world.dispatcher, {
    driverId: linked.driver.id,
    vehicleId: vehicle.id,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/accept`, linked.session, {})).status).toBe(200)

  const refused = await call('POST', `/api/rides/${recorded.ride.id}/decline`, linked.session, {})
  expect(refused.status).toBe(409)
  expect(await refused.text()).toContain('ride_not_declinable')
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'accepted',
    driver_id: linked.driver.id,
    vehicle_id: vehicle.id,
    must_accept: true,
  })
  expect((await listUpcomingRides(linked.session)).rides.map(ride => ride.rideId)).toContain(recorded.ride.id)
  expect(await declineAudits(world.tenantId)).toEqual([])
  expect(await declineAlertRows(world.tenantId)).toEqual([])

  const other = await linkedDriver(world, 'hasg-dec-other@example.test', 'Drugi Vozač', '+385911110855')
  const stolen = await call('POST', `/api/rides/${recorded.ride.id}/decline`, other.session, {})
  expect(stolen.status).toBe(404)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'accepted', driver_id: linked.driver.id })

  const foreign = await office('hasg-dec-foreign')
  expect((await call('POST', `/api/rides/${recorded.ride.id}/decline`, foreign.dispatcher, {})).status).toBe(403)
  expect(await declineAudits(world.tenantId)).toEqual([])
  expect(await declineAlertRows(foreign.tenantId)).toEqual([])
})
