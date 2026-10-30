import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { driverUpcomingListSchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { archivePartner, createPartner } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { acceptRideByPhone, assignRide, createTransfer } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import postCancel from './rides/[id]/cancel.post'
import postDone from './rides/[id]/done.post'
import postHandOff from './rides/[id]/hand-off.post'
import postNoShow from './rides/[id]/no-show.post'
import postPartner from './rides/[id]/partner.post'
import postTakeBack from './rides/[id]/take-back.post'
import getUpcoming from './rides/upcoming.get'
import patchTransfer from './transfers/[id].patch'

/**
 * Handing a Ride to a Partner (ADR-0048). The route is the proof: a 409
 * writes nothing, sends no work order, and appends no audit entry.
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
const password = 'handoff-http-password'
const phone = '+385911110409'
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
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  const id = pathOnly.slice(pathOnly.lastIndexOf('/') + 1)
  event.context.params = { id }
  if (event.method === 'PATCH')
    return patchTransfer(event)
  return new Response('Not Found', { status: 404 })
})
const callHttp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'hoff-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'hoff-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'hoff-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'hoff-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'hoff-%'`)
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

async function withAppTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
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

async function office(slug: string) {
  const created = await tenant(slug)
  const dispatcherId = await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const admin = await signIn(`${slug}-admin@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Hotel Park', kind: 'hotel' })
  return { ...created, dispatcherId, dispatcher, admin, client, start, end }
}

function transferBody(world: Awaited<ReturnType<typeof office>>, pickupAt: string, guestName = guest) {
  return {
    externalId: crypto.randomUUID(),
    clientId: world.client.id,
    pickupAt,
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName,
    price: 10,
    payment: 'cash' as const,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  }
}

function hoursAhead(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

async function rideRow(rideId: string) {
  const result = await ownerPool.query<{
    state: string
    driver_id: string | null
    vehicle_id: string | null
    must_accept: boolean | null
    partner_id: string | null
  }>(
    `select state, driver_id, vehicle_id, must_accept, partner_id from app.rides where id = $1`,
    [rideId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing ride')
  return row
}

async function versionOf(rideId: string) {
  const result = await ownerPool.query<{ version: string, data_changed_by: string | null }>(
    `select t.version::text, t.data_changed_by
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing transfer')
  return { version: Number(row.version), dataChangedBy: row.data_changed_by }
}

async function auditCount(tenantId: string) {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function mailCount(tenantId: string) {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.mail_outbox where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function handoffAudits(tenantId: string) {
  const result = await ownerPool.query<{ action: string, actor_user_id: string, data: unknown }>(
    `select action, actor_user_id, data from app.audit_entry
     where tenant_id = $1 and action::text in ('ride.handed_off', 'ride.partner_changed', 'ride.taken_back', 'ride.done', 'ride.no_show', 'ride.no_show_early', 'ride.cancelled')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function workOrders(rideId: string) {
  const result = await ownerPool.query<{ work_order_status: string }>(
    `select work_order_status from app.mail_outbox where ride_id = $1 order by created_at, id`,
    [rideId],
  )
  return result.rows.map(row => row.work_order_status)
}

/** A refusal leaves the Ride, the version, the audit log, and the outbox as they were. */
async function unchanged(
  tenantId: string,
  rideId: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const beforeRide = await rideRow(rideId)
  const beforeVersion = await versionOf(rideId)
  const beforeAudit = await auditCount(tenantId)
  const beforeMail = await mailCount(tenantId)
  const response = await run()
  expect(await rideRow(rideId)).toEqual(beforeRide)
  expect(await versionOf(rideId)).toEqual(beforeVersion)
  expect(await auditCount(tenantId)).toBe(beforeAudit)
  expect(await mailCount(tenantId)).toBe(beforeMail)
  return response
}

it('a bad body is 400 before a session, and a missing session is 401', async () => {
  const world = await office('hoff-body')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2)))
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })

  const extra = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: 0,
    confirm: true,
    phone,
  })
  expect(extra.status).toBe(400)
  expect(await extra.text()).not.toContain(phone)

  const missingVersion = await call('POST', `/api/rides/${recorded.ride.id}/partner`, world.dispatcher, { partnerId: partner.id })
  expect(missingVersion.status).toBe(400)

  expect((await call('POST', '/api/rides/not-a-ride/take-back', world.dispatcher, { version: 0 })).status).toBe(400)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, undefined, { partnerId: partner.id, version: 0 })).status).toBe(401)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'unassigned', partner_id: null })
})

it('a driver is 403, and an office handoff from unassigned names the Partner and bumps the version', async () => {
  const world = await office('hoff-open')
  await addMember(world.tenantId, 'hoff-open-driver@example.test', 'Drago Driver', 'driver')
  const driverSession = await signIn('hoff-open-driver@example.test')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(3)))
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const opened = await versionOf(recorded.ride.id)

  const refused = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/hand-off`,
    driverSession,
    { partnerId: partner.id, version: opened.version },
  ))
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(phone)

  const handed = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: opened.version,
  })
  expect(handed.status).toBe(200)
  expect(await handed.json()).toEqual({
    ride: {
      id: recorded.ride.id,
      transferId: recorded.transfer.id,
      state: 'handed_off',
      driverId: null,
      vehicleId: null,
      mustAccept: null,
      partnerId: partner.id,
    },
    workOrders: [],
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'handed_off',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
    partner_id: partner.id,
  })
  expect(await versionOf(recorded.ride.id)).toEqual({
    version: opened.version + 1,
    dataChangedBy: world.dispatcherId,
  })
  expect(await handoffAudits(world.tenantId)).toContainEqual({
    action: 'ride.handed_off',
    actor_user_id: world.dispatcherId,
    data: { rideId: recorded.ride.id, partnerId: partner.id, fields: ['state', 'partnerId'] },
  })
  expect(await workOrders(recorded.ride.id)).toEqual([])
})

it('handoff from assigned and accepted clears the crew and mails no longer yours', async () => {
  const world = await office('hoff-clear')
  const driver = await createDriver(world.dispatcher, {
    name: 'Marko Vozač',
    kind: 'own',
    phone,
    email: 'marko-hoff@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG4091AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const assignedRide = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(4)))
  await assignRide(world.dispatcher, {
    rideId: assignedRide.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: (await versionOf(assignedRide.ride.id)).version,
  })
  const assignedVersion = await versionOf(assignedRide.ride.id)
  const assigned = await call('POST', `/api/rides/${assignedRide.ride.id}/hand-off`, world.admin, {
    partnerId: partner.id,
    version: assignedVersion.version,
  })
  expect(assigned.status).toBe(200)
  expect((await assigned.json()).workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
  expect(await rideRow(assignedRide.ride.id)).toEqual({
    state: 'handed_off',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
    partner_id: partner.id,
  })
  expect(await versionOf(assignedRide.ride.id)).toMatchObject({
    version: assignedVersion.version + 1,
    dataChangedBy: world.adminUserId,
  })
  expect(await workOrders(assignedRide.ride.id)).toContain('no_longer_yours')
  const cleared = (await handoffAudits(world.tenantId)).find(row => row.action === 'ride.handed_off')
  expect(cleared?.data).toEqual({
    rideId: assignedRide.ride.id,
    partnerId: partner.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    fields: ['state', 'partnerId', 'driverId', 'vehicleId', 'mustAccept'],
  })

  await updateDriver(world.admin, driver.id, { mustAccept: true })
  const acceptedRide = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(12)))
  await assignRide(world.dispatcher, {
    rideId: acceptedRide.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: (await versionOf(acceptedRide.ride.id)).version,
  })
  await acceptRideByPhone(world.dispatcher, acceptedRide.ride.id, {})
  const acceptedVersion = await versionOf(acceptedRide.ride.id)
  const accepted = await call('POST', `/api/rides/${acceptedRide.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: acceptedVersion.version,
  })
  expect(accepted.status).toBe(200)
  expect(await rideRow(acceptedRide.ride.id)).toMatchObject({
    state: 'handed_off',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
    partner_id: partner.id,
  })
  expect((await accepted.json()).workOrders).toEqual([{ driverId: driver.id, outcome: 'sent' }])
})

it('a stale version, a finished Ride, and the same or an archived Partner write nothing', async () => {
  const world = await office('hoff-refuse')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(5)))
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const other = await createPartner(world.dispatcher, { name: 'Druga Mora' })
  const archived = await createPartner(world.dispatcher, { name: 'Stara Mora' })
  await archivePartner(world.dispatcher, archived.id)
  const opened = await versionOf(recorded.ride.id)

  const stale = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/hand-off`,
    world.dispatcher,
    { partnerId: partner.id, version: opened.version + 9 },
  ))
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ data: { code: 'stale_save' } })

  const archivedHand = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/hand-off`,
    world.dispatcher,
    { partnerId: archived.id, version: opened.version },
  ))
  expect(archivedHand.status).toBe(409)
  expect(await archivedHand.json()).toMatchObject({ data: { code: 'ride_partner_archived' } })

  const handed = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: opened.version,
  })
  expect(handed.status).toBe(200)
  const current = await versionOf(recorded.ride.id)

  const staleChange = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/partner`,
    world.dispatcher,
    { partnerId: other.id, version: current.version + 9 },
  ))
  expect(staleChange.status).toBe(409)
  expect(await staleChange.json()).toMatchObject({ data: { code: 'stale_save' } })

  const staleBack = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/take-back`,
    world.dispatcher,
    { version: current.version + 9 },
  ))
  expect(staleBack.status).toBe(409)
  expect(await staleBack.json()).toMatchObject({ data: { code: 'stale_save' } })

  const again = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/hand-off`,
    world.dispatcher,
    { partnerId: other.id, version: current.version },
  ))
  expect(again.status).toBe(409)
  expect(await again.json()).toMatchObject({ data: { code: 'ride_not_handoffable' } })

  const same = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/partner`,
    world.dispatcher,
    { partnerId: partner.id, version: current.version },
  ))
  expect(same.status).toBe(409)
  expect(await same.json()).toMatchObject({ data: { code: 'ride_partner_unchanged' } })

  const ontoArchived = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/partner`,
    world.dispatcher,
    { partnerId: archived.id, version: current.version },
  ))
  expect(ontoArchived.status).toBe(409)
  expect(await ontoArchived.json()).toMatchObject({ data: { code: 'ride_partner_archived' } })

  const open = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(6)))
  const openVersion = await versionOf(open.ride.id)
  const notHanded = await unchanged(world.tenantId, open.ride.id, () => call(
    'POST',
    `/api/rides/${open.ride.id}/take-back`,
    world.dispatcher,
    { version: openVersion.version },
  ))
  expect(notHanded.status).toBe(409)
  expect(await notHanded.json()).toMatchObject({ data: { code: 'ride_not_handed_off' } })
})

it('changes the Partner, then takes the Ride back, without mail', async () => {
  const world = await office('hoff-move')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(7)))
  const first = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const second = await createPartner(world.dispatcher, { name: 'Druga Mora' })
  const opened = await versionOf(recorded.ride.id)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: first.id,
    version: opened.version,
  })).status).toBe(200)

  const changedVersion = await versionOf(recorded.ride.id)
  const changed = await call('POST', `/api/rides/${recorded.ride.id}/partner`, world.admin, {
    partnerId: second.id,
    version: changedVersion.version,
  })
  expect(changed.status).toBe(200)
  expect(await changed.json()).toMatchObject({
    ride: { state: 'handed_off', partnerId: second.id, driverId: null },
    workOrders: [],
  })
  expect(await versionOf(recorded.ride.id)).toEqual({
    version: changedVersion.version + 1,
    dataChangedBy: world.adminUserId,
  })
  expect(await workOrders(recorded.ride.id)).toEqual([])

  const takenVersion = await versionOf(recorded.ride.id)
  const taken = await call('POST', `/api/rides/${recorded.ride.id}/take-back`, world.dispatcher, {
    version: takenVersion.version,
  })
  expect(taken.status).toBe(200)
  expect(await taken.json()).toMatchObject({
    ride: { state: 'unassigned', partnerId: null, driverId: null, vehicleId: null, mustAccept: null },
    workOrders: [],
  })
  expect(await rideRow(recorded.ride.id)).toEqual({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
    partner_id: null,
  })
  expect(await versionOf(recorded.ride.id)).toMatchObject({ version: takenVersion.version + 1 })
  const audits = await handoffAudits(world.tenantId)
  expect(audits.map(row => row.action)).toEqual(['ride.handed_off', 'ride.partner_changed', 'ride.taken_back'])
  expect(audits[1]?.data).toEqual({
    rideId: recorded.ride.id,
    partnerId: second.id,
    fields: ['partnerId'],
  })
  expect(audits[2]?.data).toEqual({
    rideId: recorded.ride.id,
    partnerId: second.id,
    fields: ['state', 'partnerId'],
  })
})

it('an archived Partner can still be closed, taken back, or replaced by an active one', async () => {
  const world = await office('hoff-keep')
  const active = await createPartner(world.dispatcher, { name: 'Aktivna Mora' })
  const kept = await createPartner(world.dispatcher, { name: 'Arhivirana Mora' })

  async function hand(hours: number) {
    const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(hours)))
    const opened = await versionOf(recorded.ride.id)
    expect((await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
      partnerId: kept.id,
      version: opened.version,
    })).status).toBe(200)
    return recorded
  }

  const doneRide = await hand(20)
  const noShowRide = await hand(26)
  const backRide = await hand(32)
  const changeRide = await hand(38)
  await archivePartner(world.dispatcher, kept.id)

  const doneVersion = await versionOf(doneRide.ride.id)
  const done = await call('POST', `/api/rides/${doneRide.ride.id}/done`, world.dispatcher, {})
  expect(done.status).toBe(200)
  expect(await rideRow(doneRide.ride.id)).toMatchObject({ state: 'done', partner_id: null, driver_id: null })
  expect(await versionOf(doneRide.ride.id)).toEqual(doneVersion)

  const noShow = await call('POST', `/api/rides/${noShowRide.ride.id}/no-show`, world.admin, {})
  expect(noShow.status).toBe(200)
  expect(await rideRow(noShowRide.ride.id)).toMatchObject({ state: 'no-show', partner_id: null })

  const backVersion = await versionOf(backRide.ride.id)
  const back = await call('POST', `/api/rides/${backRide.ride.id}/take-back`, world.dispatcher, { version: backVersion.version })
  expect(back.status).toBe(200)
  expect(await rideRow(backRide.ride.id)).toMatchObject({ state: 'unassigned', partner_id: null })

  const changeVersion = await versionOf(changeRide.ride.id)
  const changed = await call('POST', `/api/rides/${changeRide.ride.id}/partner`, world.dispatcher, {
    partnerId: active.id,
    version: changeVersion.version,
  })
  expect(changed.status).toBe(200)
  expect(await rideRow(changeRide.ride.id)).toMatchObject({ state: 'handed_off', partner_id: active.id })

  const closeAudits = (await handoffAudits(world.tenantId)).filter(row => row.action === 'ride.done' || row.action === 'ride.no_show_early')
  expect(closeAudits).toEqual([
    {
      action: 'ride.done',
      actor_user_id: world.dispatcherId,
      data: { rideId: doneRide.ride.id, driverId: kept.id, fields: ['state'] },
    },
    {
      action: 'ride.no_show_early',
      actor_user_id: world.adminUserId,
      data: { rideId: noShowRide.ride.id, driverId: kept.id, fields: ['state'] },
    },
  ])
  expect(await workOrders(doneRide.ride.id)).toEqual([])
  expect(await workOrders(noShowRide.ride.id)).toEqual([])
})

it('cancels a handed-off Ride without mail or a version bump, and a driver cannot close one', async () => {
  const world = await office('hoff-close')
  const driverUserId = await addMember(world.tenantId, 'hoff-close-driver@example.test', 'Drago Driver', 'driver')
  const driverSession = await signIn('hoff-close-driver@example.test')
  await createDriver(world.dispatcher, {
    name: 'Drago Vozač',
    kind: 'own',
    phone: '+385911110410',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
    memberUserId: driverUserId,
  })
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(8)))
  const other = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(9)))
  const opened = await versionOf(recorded.ride.id)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: opened.version,
  })).status).toBe(200)
  expect((await call('POST', `/api/rides/${other.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: (await versionOf(other.ride.id)).version,
  })).status).toBe(200)

  const driverDone = await unchanged(world.tenantId, recorded.ride.id, () => call('POST', `/api/rides/${recorded.ride.id}/done`, driverSession, {}))
  expect(driverDone.status).toBe(403)
  const driverNoShow = await unchanged(world.tenantId, recorded.ride.id, () => call('POST', `/api/rides/${recorded.ride.id}/no-show`, driverSession, {}))
  expect(driverNoShow.status).toBe(403)
  const driverCancel = await unchanged(world.tenantId, recorded.ride.id, () => call('POST', `/api/rides/${recorded.ride.id}/cancel`, driverSession, {}))
  expect(driverCancel.status).toBe(403)
  const driverChange = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/partner`,
    driverSession,
    { partnerId: partner.id, version: opened.version },
  ))
  expect(driverChange.status).toBe(403)
  const driverBack = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/take-back`,
    driverSession,
    { version: opened.version },
  ))
  expect(driverBack.status).toBe(403)

  const cancelVersion = await versionOf(recorded.ride.id)
  const cancelled = await call('POST', `/api/rides/${recorded.ride.id}/cancel`, world.dispatcher, {})
  expect(cancelled.status).toBe(200)
  expect(await cancelled.json()).toMatchObject({
    ride: { state: 'cancelled', driverId: null, vehicleId: null, mustAccept: null },
    workOrders: [],
  })
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'cancelled', partner_id: null })
  expect(await versionOf(recorded.ride.id)).toEqual(cancelVersion)
  expect(await workOrders(recorded.ride.id)).toEqual([])
  expect((await handoffAudits(world.tenantId)).find(row => row.action === 'ride.cancelled')?.data).toEqual({
    rideId: recorded.ride.id,
    driverId: partner.id,
    fields: ['state'],
  })

  const latePickup = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const late = await createTransfer(world.dispatcher, transferBody(world, latePickup))
  expect((await call('POST', `/api/rides/${late.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: (await versionOf(late.ride.id)).version,
  })).status).toBe(200)
  const lateNoShow = await call('POST', `/api/rides/${late.ride.id}/no-show`, world.dispatcher, {})
  expect(lateNoShow.status).toBe(200)
  expect(await rideRow(late.ride.id)).toMatchObject({ state: 'no-show', partner_id: null })
  const lateRows = (await handoffAudits(world.tenantId)).filter((row) => {
    const data = row.data as { rideId?: string }
    return data.rideId === late.ride.id
  })
  expect(lateRows.map(row => row.action)).toEqual(['ride.handed_off', 'ride.no_show'])
  expect(lateRows[1]?.data).toEqual({
    rideId: late.ride.id,
    driverId: partner.id,
    fields: ['state'],
  })
})

it('another Tenant\'s Partner or Ride is 404, and the foreign key refuses the other Partner', async () => {
  const world = await office('hoff-tenant-a')
  const other = await office('hoff-tenant-b')
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(10)))
  const partner = await createPartner(other.dispatcher, { name: 'Tuđa Mora' })
  const opened = await versionOf(recorded.ride.id)

  const foreignPartner = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/hand-off`,
    world.dispatcher,
    { partnerId: partner.id, version: opened.version },
  ))
  expect(foreignPartner.status).toBe(404)

  const foreignRide = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, other.dispatcher, {
    partnerId: partner.id,
    version: opened.version,
  })
  expect(foreignRide.status).toBe(404)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'unassigned', partner_id: null })

  const ours = await createPartner(world.dispatcher, { name: 'Naša Mora' })
  const handed = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: ours.id,
    version: opened.version,
  })
  expect(handed.status).toBe(200)
  const held = await versionOf(recorded.ride.id)

  const foreignChange = await unchanged(world.tenantId, recorded.ride.id, () => call(
    'POST',
    `/api/rides/${recorded.ride.id}/partner`,
    world.dispatcher,
    { partnerId: partner.id, version: held.version },
  ))
  expect(foreignChange.status).toBe(404)

  const foreignBack = await call('POST', `/api/rides/${recorded.ride.id}/take-back`, other.dispatcher, {
    version: held.version,
  })
  expect(foreignBack.status).toBe(404)
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'handed_off', partner_id: ours.id })

  // An unassigned row with a Partner fails the iff check first. A handed-off
  // write names the other Tenant's Partner, so the composite foreign key is what refuses.
  const error = await withAppTenant(world.tenantId, client => client.query(
    `update app.rides
     set state = 'handed_off', partner_id = $2, driver_id = null, vehicle_id = null, must_accept = null
     where id = $1`,
    [recorded.ride.id, partner.id],
  )).then(() => undefined, (caught: unknown) => caught)
  expect(error).toMatchObject({ code: '23503' })
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'handed_off', partner_id: ours.id })
})

it('drops a handed-off Ride from the Driver list and lets a correction through without a work order', async () => {
  const world = await office('hoff-phone')
  const driverUserId = await addMember(world.tenantId, 'hoff-phone-driver@example.test', 'Drago Driver', 'driver')
  const driverSession = await signIn('hoff-phone-driver@example.test')
  const driver = await createDriver(world.dispatcher, {
    name: 'Drago Vozač',
    kind: 'own',
    phone: '+385911110411',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
    memberUserId: driverUserId,
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: 'ZG4092AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const partner = await createPartner(world.dispatcher, { name: 'Mora Transfer' })
  const pickupAt = hoursAhead(14)
  const recorded = await createTransfer(world.dispatcher, transferBody(world, pickupAt))
  await assignRide(world.dispatcher, {
    rideId: recorded.ride.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    version: (await versionOf(recorded.ride.id)).version,
  })
  const before = driverUpcomingListSchema.parse(await (await call('GET', '/api/rides/upcoming', driverSession)).json())
  expect(before.rides.map(ride => ride.rideId)).toContain(recorded.ride.id)

  const opened = await versionOf(recorded.ride.id)
  expect((await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: partner.id,
    version: opened.version,
  })).status).toBe(200)
  const after = driverUpcomingListSchema.parse(await (await call('GET', '/api/rides/upcoming', driverSession)).json())
  expect(after.rides.map(ride => ride.rideId)).not.toContain(recorded.ride.id)

  const correctionVersion = await versionOf(recorded.ride.id)
  const moved = hoursAhead(15)
  const corrected = await call('PATCH', `/api/transfers/${recorded.transfer.id}`, world.dispatcher, {
    clientId: world.client.id,
    pickupAt: moved,
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 2,
    guestName: 'Iva Ivić',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    version: correctionVersion.version,
  })
  expect(corrected.status).toBe(200)
  const body = await corrected.json()
  expect(body.ride).toMatchObject({ state: 'handed_off' })
  expect(body.workOrders).toEqual([])
  expect(body.relocationWarnings).toEqual([])
  expect(await rideRow(recorded.ride.id)).toMatchObject({
    state: 'handed_off',
    partner_id: partner.id,
    driver_id: null,
    vehicle_id: null,
  })
})
