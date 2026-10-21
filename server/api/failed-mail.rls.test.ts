import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { failedMailResendSchema, officeHomeSchema, officeHomeUrgentRideCount } from '../../shared'
import { configureLogger } from '../core/index'
import { captureLogs } from '../core/testing'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { assignRide, createTransfer, readOfficeHome, resendFailedMail } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import getOfficeHome from './office-home.get'
import resendFailed from './office-home/failed-mail/[entryId]/resend.post'

/**
 * Home lists failed work orders that still matter, and one route resends one.
 * Pickup time does not hide a row. "No longer yours" stays after a cancel.
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
const password = 'failed-mail-http-password'
const authUrl = required('BETTER_AUTH_URL')
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })

configureLogger('info')

const app = createApp()
app.use('/api/office-home', (event) => {
  // The mount strips `/api/office-home`, and this test app does not fill :param.
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '') || '/'
  const marker = '/failed-mail/'
  if (event.method === 'POST' && pathOnly.startsWith(marker) && pathOnly.endsWith('/resend')) {
    const entryId = decodeURIComponent(pathOnly.slice(marker.length, -'/resend'.length))
    event.context.params = { entryId }
    return resendFailed(event)
  }
  if (event.method === 'GET' && pathOnly === '/')
    return getOfficeHome(event)
  return new Response('Not Found', { status: 404 })
})
const callApp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'fmail-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'fmail-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'fmail-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'fmail-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'fmail-%'`)
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

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function plant(input: {
  tenantId: string
  rideId: string
  driverId: string
  status: 'assigned' | 'changed' | 'cancelled' | 'no_longer_yours'
  state: 'failed' | 'sent' | 'stale' | 'pending'
  vehicleId?: string
  createdAt: Date
}): Promise<string> {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.mail_outbox (
       tenant_id, kind, ride_id, driver_id, vehicle_id, work_order_status, state, attempt_count, created_at
     ) values ($1, 'work_order', $2, $3, $4, $5, $6, 4, $7)
     returning id`,
    [
      input.tenantId,
      input.rideId,
      input.driverId,
      input.status === 'no_longer_yours' ? input.vehicleId ?? null : null,
      input.status,
      input.state,
      input.createdAt,
    ],
  )
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('mail row missing')
  return id
}

async function outboxState(entryId: string): Promise<{ state: string, attempt_count: number }> {
  const result = await ownerPool.query<{ state: string, attempt_count: number }>(
    `select state, attempt_count from app.mail_outbox where id = $1`,
    [entryId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('mail row missing')
  return row
}

function post(entryId: string, session?: Headers, body: unknown = {}) {
  const headers = new Headers(session)
  headers.set('content-type', 'application/json')
  return callApp(new Request(`http://localhost/api/office-home/failed-mail/${entryId}/resend`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }))
}

it('lists only failed work orders that still matter, and a driver cannot read them', async () => {
  const created = await tenant('fmail-read')
  await addMember(created.tenantId, 'fmail-read-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'fmail-read-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('fmail-read-admin@example.test')
  const dispatcher = await signIn('fmail-read-dispatcher@example.test')
  const driverSession = await signIn('fmail-read-driver@example.test')
  const other = await tenant('fmail-read-other')
  const outsider = await signIn('fmail-read-other-admin@example.test')
  const address = 'ana-fmail@example.test'

  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(admin, {
    name: 'Ana Slobodna',
    kind: 'own',
    phone: '+385911110330',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(admin, {
    registrationPlate: 'DU330AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })

  let day = 0
  async function ride(guestName: string): Promise<string> {
    // A day apart, so the same Driver and Vehicle do not overlap.
    const pickupAt = new Date(Date.parse('2026-11-02T09:00:00.000Z') + day * 24 * 60 * 60 * 1000).toISOString()
    day += 1
    const recorded = await createTransfer(admin, {
      externalId: crypto.randomUUID(),
      clientId: client.id,
      pickupAt,
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
    await assignRide(admin, { rideId: recorded.ride.id, driverId: driver.id, vehicleId: vehicle.id, version: 0 })
    return recorded.ride.id
  }

  const openId = await ride('Open Klara')
  const doneId = await ride('Done Klara')
  const cancelledId = await ride('Cancel Klara')
  const noticeId = await ride('Notice Klara')
  const lostId = await ride('Lost Klara')
  const replacedId = await ride('Replaced Klara')
  await ownerPool.query(`update app.rides set state = 'done' where id = $1`, [doneId])
  await ownerPool.query(`update app.rides set state = 'cancelled' where id = $1`, [cancelledId])
  await ownerPool.query(`update app.rides set state = 'cancelled' where id = $1`, [noticeId])
  await ownerPool.query(`update app.rides set state = 'cancelled' where id = $1`, [lostId])

  const later = new Date('2026-11-02T12:00:00.000Z')
  const earlier = new Date('2026-11-02T08:00:00.000Z')
  const current = await plant({
    tenantId: created.tenantId,
    rideId: openId,
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: openId,
    driverId: driver.id,
    status: 'changed',
    state: 'sent',
    createdAt: earlier,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: openId,
    driverId: driver.id,
    status: 'changed',
    state: 'stale',
    createdAt: earlier,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: doneId,
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: cancelledId,
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  const notice = await plant({
    tenantId: created.tenantId,
    rideId: noticeId,
    driverId: driver.id,
    status: 'cancelled',
    state: 'failed',
    createdAt: later,
  })
  const lost = await plant({
    tenantId: created.tenantId,
    rideId: lostId,
    driverId: driver.id,
    status: 'no_longer_yours',
    state: 'failed',
    vehicleId: vehicle.id,
    createdAt: later,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: replacedId,
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: earlier,
  })
  await plant({
    tenantId: created.tenantId,
    rideId: replacedId,
    driverId: driver.id,
    status: 'changed',
    state: 'sent',
    createdAt: later,
  })
  await ownerPool.query(
    `insert into app.mail_outbox (tenant_id, kind, invitation_id, state, attempt_count)
     values ($1, 'invitation', gen_random_uuid(), 'failed', 4)`,
    [created.tenantId],
  )

  const otherClient = await createClient(outsider, { name: 'Druga Agencija', kind: 'agency' })
  const otherStart = await createLocation(outsider, { name: 'Polazak', kind: 'address' })
  const otherEnd = await createLocation(outsider, { name: 'Dolazak', kind: 'address' })
  const otherDriver = await createDriver(outsider, {
    name: 'Ivo Drugi',
    kind: 'own',
    phone: '+385911110331',
    email: 'ivo-fmail@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const otherVehicle = await createVehicle(outsider, {
    registrationPlate: 'ZG331AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const otherRecorded = await createTransfer(outsider, {
    externalId: crypto.randomUUID(),
    clientId: otherClient.id,
    pickupAt: '2026-11-02T09:00:00.000Z',
    startLocationId: otherStart.id,
    endLocationId: otherEnd.id,
    passengerCount: 1,
    guestName: 'Tuđi Gost',
    price: 10,
    payment: 'card',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  await assignRide(outsider, {
    rideId: otherRecorded.ride.id,
    driverId: otherDriver.id,
    vehicleId: otherVehicle.id,
    version: 0,
  })
  const foreign = await plant({
    tenantId: other.tenantId,
    rideId: otherRecorded.ride.id,
    driverId: otherDriver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })

  const audits = await auditCount(created.tenantId)
  const snapshot = officeHomeSchema.parse(await readOfficeHome(admin))
  expect(officeHomeSchema.parse(await readOfficeHome(dispatcher)).failedMails).toEqual(snapshot.failedMails)
  expect(snapshot.failedMails.map(row => row.entryId).sort()).toEqual([current, notice, lost].sort())
  expect(snapshot.failedMails.find(row => row.entryId === lost)).toMatchObject({
    driverName: 'Ana Slobodna',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    status: 'no_longer_yours',
  })
  expect(JSON.stringify(snapshot.failedMails)).not.toContain(address)
  expect(JSON.stringify(snapshot.failedMails)).not.toContain('Open Klara')
  expect(officeHomeUrgentRideCount(snapshot)).toBe(officeHomeUrgentRideCount({ ...snapshot, failedMails: [] }))
  expect(await auditCount(created.tenantId)).toBe(audits)

  const refused = await callApp(new Request('http://localhost/api/office-home', { headers: driverSession }))
  expect(refused.status).toBe(403)
  const hidden = officeHomeSchema.parse(await readOfficeHome(outsider))
  expect(hidden.failedMails.map(row => row.entryId)).not.toContain(current)
  expect(hidden.failedMails.map(row => row.entryId)).toContain(foreign)
})

it('resends one failed work order, refuses the other roles, and does not audit', async () => {
  const created = await tenant('fmail-send')
  await addMember(created.tenantId, 'fmail-send-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'fmail-send-driver@example.test', 'Drago Driver', 'driver')
  const admin = await signIn('fmail-send-admin@example.test')
  const dispatcher = await signIn('fmail-send-dispatcher@example.test')
  const driverSession = await signIn('fmail-send-driver@example.test')
  const other = await tenant('fmail-send-other')
  const outsider = await signIn('fmail-send-other-admin@example.test')
  const address = 'ana-resend@example.test'

  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Excelsior', kind: 'hotel' })
  const driver = await createDriver(admin, {
    name: 'Ana Slobodna',
    kind: 'own',
    phone: '+385911110332',
    email: address,
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const blankDriver = await createDriver(admin, {
    name: 'Bez Adrese',
    kind: 'own',
    phone: '+385911110333',
    email: 'blank-fmail@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(admin, {
    registrationPlate: 'DU332AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })

  let day = 0
  async function ride(guestName: string, driverId: string): Promise<string> {
    // A day apart, so the same Driver and Vehicle do not overlap.
    const pickupAt = new Date(Date.parse('2026-11-03T09:00:00.000Z') + day * 24 * 60 * 60 * 1000).toISOString()
    day += 1
    const recorded = await createTransfer(admin, {
      externalId: crypto.randomUUID(),
      clientId: client.id,
      pickupAt,
      startLocationId: start.id,
      endLocationId: end.id,
      passengerCount: 1,
      guestName,
      price: 12,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    })
    await assignRide(admin, { rideId: recorded.ride.id, driverId, vehicleId: vehicle.id, version: 0 })
    return recorded.ride.id
  }

  const later = new Date('2026-11-03T12:00:00.000Z')
  const successId = await plant({
    tenantId: created.tenantId,
    rideId: await ride('Send Klara', driver.id),
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  const staleRide = await ride('Stale Klara', driver.id)
  const staleId = await plant({
    tenantId: created.tenantId,
    rideId: staleRide,
    driverId: driver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  const blankRide = await ride('Blank Klara', blankDriver.id)
  const blankId = await plant({
    tenantId: created.tenantId,
    rideId: blankRide,
    driverId: blankDriver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })
  const rejectId = await plant({
    tenantId: created.tenantId,
    rideId: await ride('Reject Klara', driver.id),
    driverId: driver.id,
    status: 'changed',
    state: 'failed',
    createdAt: later,
  })
  await updateDriver(admin, blankDriver.id, { email: null })

  const otherClient = await createClient(outsider, { name: 'Druga Agencija', kind: 'agency' })
  const otherStart = await createLocation(outsider, { name: 'Polazak', kind: 'address' })
  const otherEnd = await createLocation(outsider, { name: 'Dolazak', kind: 'address' })
  const otherDriver = await createDriver(outsider, {
    name: 'Ivo Drugi',
    kind: 'own',
    phone: '+385911110334',
    email: 'ivo-resend@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const otherVehicle = await createVehicle(outsider, {
    registrationPlate: 'ZG334AA',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const otherRecorded = await createTransfer(outsider, {
    externalId: crypto.randomUUID(),
    clientId: otherClient.id,
    pickupAt: '2026-11-03T09:00:00.000Z',
    startLocationId: otherStart.id,
    endLocationId: otherEnd.id,
    passengerCount: 1,
    guestName: 'Tuđi Gost',
    price: 10,
    payment: 'card',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })
  await assignRide(outsider, {
    rideId: otherRecorded.ride.id,
    driverId: otherDriver.id,
    vehicleId: otherVehicle.id,
    version: 0,
  })
  const foreign = await plant({
    tenantId: other.tenantId,
    rideId: otherRecorded.ride.id,
    driverId: otherDriver.id,
    status: 'assigned',
    state: 'failed',
    createdAt: later,
  })

  const unsigned = await post(successId)
  expect(unsigned.status).toBe(401)
  const driverRefused = await post(successId, driverSession)
  expect(driverRefused.status).toBe(403)
  expect(await driverRefused.text()).not.toContain(address)
  const badId = await post('not-an-id', admin)
  expect(badId.status).toBe(400)
  const extra = await post(successId, admin, { email: address })
  expect(extra.status).toBe(400)
  const missing = await post(crypto.randomUUID(), admin)
  expect(missing.status).toBe(404)
  const cross = await post(foreign, admin)
  expect(cross.status).toBe(404)
  expect(await outboxState(foreign)).toMatchObject({ state: 'failed', attempt_count: 4 })

  const audits = await auditCount(created.tenantId)
  const jobsBefore = await jobCount(successId)
  const logs = captureLogs()
  const sent = failedMailResendSchema.parse(await resendFailedMail(dispatcher, successId, {}, undefined, logs.logger))
  expect(sent).toEqual({ outcome: 'sent' })
  expect(await outboxState(successId)).toEqual({ state: 'sent', attempt_count: 4 })
  expect(await jobCount(successId)).toBe(jobsBefore)
  expect(await auditCount(created.tenantId)).toBe(audits)
  const [line] = logs.lines()
  const { level: _level, time: _time, pid: _pid, hostname: _hostname, ...rest } = line ?? {}
  expect(rest).toMatchObject({
    event: 'mail_outbox.resend',
    entryId: successId,
    kind: 'work_order',
    outcome: 'sent',
  })
  expect(JSON.stringify(line)).not.toContain(address)
  const home = officeHomeSchema.parse(await readOfficeHome(admin))
  expect(home.failedMails.map(row => row.entryId)).not.toContain(successId)

  await ownerPool.query(`update app.rides set state = 'done' where id = $1`, [staleRide])
  const staleResponse = await post(staleId, admin)
  expect(staleResponse.status).toBe(200)
  const stalePayload = await staleResponse.json()
  expect(failedMailResendSchema.parse(stalePayload)).toEqual({ outcome: 'stale' })
  expect(JSON.stringify(stalePayload)).not.toContain(address)
  expect(await outboxState(staleId)).toEqual({ state: 'stale', attempt_count: 4 })
  expect(JSON.stringify(officeHomeSchema.parse(await readOfficeHome(admin)).failedMails)).not.toContain(staleId)

  const blank = failedMailResendSchema.parse(await resendFailedMail(admin, blankId))
  expect(blank).toEqual({ outcome: 'failed' })
  expect(await outboxState(blankId)).toEqual({ state: 'failed', attempt_count: 4 })

  const rejected = failedMailResendSchema.parse(await resendFailedMail(admin, rejectId, {}, {
    async sendWorkOrder() {
      throw new Error(`provider down ${address}`)
    },
    async sendInvitation() {},
  }))
  expect(rejected).toEqual({ outcome: 'failed' })
  expect(await outboxState(rejectId)).toEqual({ state: 'failed', attempt_count: 4 })
  expect(await auditCount(created.tenantId)).toBe(audits)
})

async function jobCount(entryId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from pgboss.job where data::text like $1`,
    [`%${entryId}%`],
  )
  return Number(result.rows[0]?.count)
}
