import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { operationalDateInTimeZone, TENANT_TIME_ZONE_DEFAULT } from '../../shared'
import { createClient } from '../modules/clients'
import { createDriver, updateDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { archivePartner, createPartner } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { acceptRideByPhone, addUnavailability, assignRide, createTransfer, listClientRideHistory, listPartnerRideHistory, listTransferDay } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import postCancel from './rides/[id]/cancel.post'
import postDone from './rides/[id]/done.post'
import postHandOff from './rides/[id]/hand-off.post'
import postNoShow from './rides/[id]/no-show.post'
import postPartnerConfirmation from './rides/[id]/partner-confirmation.post'
import postPartner from './rides/[id]/partner.post'
import postTakeBack from './rides/[id]/take-back.post'

/**
 * Recording a Partner confirmation (ADR-0062). The route is the proof:
 * a refusal writes nothing, and success sets the flag once.
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
const password = 'partner-confirmation-http-password'
const partnerName = 'Mora Transfer PCF'
const partnerPhone = '+38591111570'
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
  if (action === 'partner-confirmation' && event.method === 'POST')
    return postPartnerConfirmation(event)
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
const callHttp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.unavailability_windows where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'pcf-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'pcf-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'pcf-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'pcf-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'pcf-%'`)
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
  const start = await createLocation(dispatcher, { name: 'Polazak Proba', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Dolazak Proba', kind: 'hotel' })
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
    partner_id: string | null
    partner_confirmed: boolean
  }>(
    `select state, partner_id, partner_confirmed from app.rides where id = $1`,
    [rideId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing ride')
  return row
}

async function versionOf(rideId: string) {
  const result = await ownerPool.query<{ version: string }>(
    `select t.version::text
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing transfer')
  return Number(row.version)
}

async function auditCount(tenantId: string) {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

async function confirmationAudits(tenantId: string) {
  const result = await ownerPool.query<{ action: string, actor_user_id: string, data: unknown }>(
    `select action, actor_user_id, data from app.audit_entry
     where tenant_id = $1
       and action::text in ('ride.partner_confirmed', 'ride.partner_confirmation_cleared')
     order by occurred_at, id`,
    [tenantId],
  )
  return result.rows
}

async function auditActions(tenantId: string) {
  const result = await ownerPool.query<{ action: string }>(
    `select action::text as action from app.audit_entry where tenant_id = $1 order by occurred_at, id`,
    [tenantId],
  )
  return result.rows.map(row => row.action)
}

/** A refusal leaves the Ride, the version, and the audit log as they were. */
async function unchanged(
  tenantId: string,
  rideId: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const beforeRide = await rideRow(rideId)
  const beforeVersion = await versionOf(rideId)
  const beforeAudit = await auditCount(tenantId)
  const response = await run()
  expect(await rideRow(rideId)).toEqual(beforeRide)
  expect(await versionOf(rideId)).toBe(beforeVersion)
  expect(await auditCount(tenantId)).toBe(beforeAudit)
  return response
}

async function handOff(session: Headers, rideId: string, partnerId: string) {
  const response = await call('POST', `/api/rides/${rideId}/hand-off`, session, {
    partnerId,
    version: await versionOf(rideId),
  })
  expect(response.status).toBe(200)
}

function confirm(session: Headers | undefined, rideId: string, version: number, extra?: Record<string, unknown>) {
  return call('POST', `/api/rides/${rideId}/partner-confirmation`, session, { version, ...extra })
}

it('refuses in order, and writes nothing: 400, then 401 or 403, then 404, then stale_save, then not awaiting', async () => {
  const world = await office('pcf-order')
  const other = await office('pcf-order-b')
  await addMember(world.tenantId, 'pcf-order-driver@example.test', 'Drago Driver', 'driver')
  const driver = await signIn('pcf-order-driver@example.test')
  const partner = await createPartner(world.dispatcher, { name: partnerName, phone: partnerPhone })
  const waiting = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2)))
  await handOff(world.dispatcher, waiting.ride.id, partner.id)
  const version = await versionOf(waiting.ride.id)
  const plain = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(3)))

  const extra = await unchanged(world.tenantId, waiting.ride.id, () => confirm(undefined, waiting.ride.id, version, { confirm: true, phone: partnerPhone }))
  expect(extra.status).toBe(400)
  expect(await extra.text()).not.toContain(partnerPhone)

  const missingVersion = await unchanged(world.tenantId, waiting.ride.id, () => call(
    'POST',
    `/api/rides/${waiting.ride.id}/partner-confirmation`,
    undefined,
    { phone: partnerPhone },
  ))
  expect(missingVersion.status).toBe(400)

  const signedOut = await unchanged(world.tenantId, waiting.ride.id, () => confirm(undefined, waiting.ride.id, version))
  expect(signedOut.status).toBe(401)

  const driverRefused = await unchanged(world.tenantId, waiting.ride.id, () => confirm(driver, waiting.ride.id, version))
  expect(driverRefused.status).toBe(403)

  const otherTenant = await unchanged(world.tenantId, waiting.ride.id, () => confirm(other.dispatcher, waiting.ride.id, version))
  expect(otherTenant.status).toBe(404)

  const beforeMissing = await auditCount(world.tenantId)
  const missing = await call('POST', `/api/rides/${crypto.randomUUID()}/partner-confirmation`, world.dispatcher, { version: 0 })
  expect(missing.status).toBe(404)
  expect(await auditCount(world.tenantId)).toBe(beforeMissing)

  const stale = await unchanged(world.tenantId, waiting.ride.id, () => confirm(world.dispatcher, waiting.ride.id, version + 1))
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ data: { code: 'stale_save' } })

  const notHandoff = await unchanged(world.tenantId, plain.ride.id, async () => confirm(world.dispatcher, plain.ride.id, await versionOf(plain.ride.id)))
  expect(notHandoff.status).toBe(409)
  expect(await notHandoff.json()).toMatchObject({ data: { code: 'ride_not_awaiting_partner_confirmation' } })
  expect(await confirmationAudits(world.tenantId)).toEqual([])
})

it('records the confirmation once, then a second recording is stale and the new version is not awaiting', async () => {
  const world = await office('pcf-once')
  const partner = await createPartner(world.dispatcher, { name: partnerName, phone: partnerPhone })
  const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2)))
  await handOff(world.dispatcher, recorded.ride.id, partner.id)
  const version = await versionOf(recorded.ride.id)

  const saved = await confirm(world.admin, recorded.ride.id, version)
  expect(saved.status).toBe(200)
  const body = await saved.text()
  expect(body).not.toContain(partnerName)
  expect(body).not.toContain(partnerPhone)
  expect(JSON.parse(body)).toEqual({ rideId: recorded.ride.id, partnerConfirmed: true, version: version + 1 })
  expect(await rideRow(recorded.ride.id)).toMatchObject({ state: 'handed_off', partner_id: partner.id, partner_confirmed: true })
  expect(await versionOf(recorded.ride.id)).toBe(version + 1)
  expect(await confirmationAudits(world.tenantId)).toEqual([{
    action: 'ride.partner_confirmed',
    actor_user_id: world.adminUserId,
    data: { rideId: recorded.ride.id, partnerId: partner.id, fields: ['partnerConfirmed'] },
  }])

  const sameForm = await unchanged(world.tenantId, recorded.ride.id, () => confirm(world.dispatcher, recorded.ride.id, version))
  expect(sameForm.status).toBe(409)
  expect(await sameForm.json()).toMatchObject({ data: { code: 'stale_save' } })

  const again = await unchanged(world.tenantId, recorded.ride.id, () => confirm(world.dispatcher, recorded.ride.id, version + 1))
  expect(again.status).toBe(409)
  expect(await again.json()).toMatchObject({ data: { code: 'ride_not_awaiting_partner_confirmation' } })
})

it('confirms an archived Partner and an unavailable Partner, and the warning stays', async () => {
  const world = await office('pcf-partner')
  const archived = await createPartner(world.dispatcher, { name: partnerName, phone: partnerPhone })
  const away = await createPartner(world.dispatcher, { name: 'Slobodni Prijevoz' })
  const pickup = hoursAhead(2)
  const first = await createTransfer(world.dispatcher, transferBody(world, pickup, 'Ana Anić'))
  const second = await createTransfer(world.dispatcher, transferBody(world, pickup, 'Ivo Ivić'))
  await handOff(world.dispatcher, first.ride.id, archived.id)
  await handOff(world.dispatcher, second.ride.id, away.id)
  await archivePartner(world.dispatcher, archived.id)
  const window = await addUnavailability(world.dispatcher, {
    partnerId: away.id,
    startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  })
  expect(window.window.partnerId).toBe(away.id)

  const day = operationalDateInTimeZone(TENANT_TIME_ZONE_DEFAULT, new Date(pickup))
  const before = (await listTransferDay(world.dispatcher, day)).rides.find(ride => ride.rideId === second.ride.id)
  expect(before?.warnings.unavailable).toEqual(['partner'])
  expect(before?.partnerConfirmed).toBe(false)

  expect((await confirm(world.dispatcher, first.ride.id, await versionOf(first.ride.id))).status).toBe(200)
  expect((await confirm(world.dispatcher, second.ride.id, await versionOf(second.ride.id))).status).toBe(200)

  const after = (await listTransferDay(world.dispatcher, day)).rides.find(ride => ride.rideId === second.ride.id)
  expect(after?.warnings.unavailable).toEqual(['partner'])
  expect(after?.partnerConfirmed).toBe(true)
  const archivedRow = (await listTransferDay(world.dispatcher, day)).rides.find(ride => ride.rideId === first.ride.id)
  expect(archivedRow?.partnerConfirmed).toBe(true)
  const stored = JSON.stringify(await confirmationAudits(world.tenantId))
  expect(stored).not.toContain(partnerName)
  expect(stored).not.toContain(partnerPhone)
})

it('a change of Partner and a take-back clear the flag without a clearing entry', async () => {
  const world = await office('pcf-clear')
  const first = await createPartner(world.dispatcher, { name: partnerName })
  const second = await createPartner(world.dispatcher, { name: 'Drugi Prijevoz' })
  const changed = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2), 'Ana Anić'))
  const taken = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(3), 'Ivo Ivić'))
  await handOff(world.dispatcher, changed.ride.id, first.id)
  await handOff(world.dispatcher, taken.ride.id, first.id)
  expect((await confirm(world.dispatcher, changed.ride.id, await versionOf(changed.ride.id))).status).toBe(200)
  expect((await confirm(world.dispatcher, taken.ride.id, await versionOf(taken.ride.id))).status).toBe(200)
  const changedVersion = await versionOf(changed.ride.id)
  const takenVersion = await versionOf(taken.ride.id)

  const partnerChange = await call('POST', `/api/rides/${changed.ride.id}/partner`, world.dispatcher, {
    partnerId: second.id,
    version: changedVersion,
  })
  expect(partnerChange.status).toBe(200)
  expect(await rideRow(changed.ride.id)).toMatchObject({ state: 'handed_off', partner_id: second.id, partner_confirmed: false })
  expect(await versionOf(changed.ride.id)).toBe(changedVersion + 1)

  const takeBack = await call('POST', `/api/rides/${taken.ride.id}/take-back`, world.dispatcher, { version: takenVersion })
  expect(takeBack.status).toBe(200)
  expect(await rideRow(taken.ride.id)).toMatchObject({ state: 'unassigned', partner_id: null, partner_confirmed: false })
  expect(await versionOf(taken.ride.id)).toBe(takenVersion + 1)

  const actions = await auditActions(world.tenantId)
  expect(actions.filter(action => action === 'ride.partner_confirmation_cleared')).toEqual([])
  expect(actions.filter(action => action === 'ride.partner_confirmed')).toHaveLength(2)
  expect(actions).toContain('ride.partner_changed')
  expect(actions).toContain('ride.taken_back')

  const afterTakeBack = await unchanged(world.tenantId, taken.ride.id, async () => confirm(world.dispatcher, taken.ride.id, await versionOf(taken.ride.id)))
  expect(afterTakeBack.status).toBe(409)
})

it('done, no-show, and cancel clear the flag and leave the version unchanged', async () => {
  const world = await office('pcf-close')
  const partner = await createPartner(world.dispatcher, { name: partnerName })
  const closed: Array<{ path: 'done' | 'no-show' | 'cancel', state: string }> = [
    { path: 'done', state: 'done' },
    { path: 'no-show', state: 'no-show' },
    { path: 'cancel', state: 'cancelled' },
  ]
  for (const [index, step] of closed.entries()) {
    const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2 + index), `Gost ${index}`))
    await handOff(world.dispatcher, recorded.ride.id, partner.id)
    expect((await confirm(world.dispatcher, recorded.ride.id, await versionOf(recorded.ride.id))).status).toBe(200)
    const version = await versionOf(recorded.ride.id)
    const response = await call('POST', `/api/rides/${recorded.ride.id}/${step.path}`, world.dispatcher, {})
    expect(response.status, step.path).toBe(200)
    expect(await rideRow(recorded.ride.id)).toMatchObject({ state: step.state, partner_id: null, partner_confirmed: false })
    expect(await versionOf(recorded.ride.id)).toBe(version)
  }
  const actions = await auditActions(world.tenantId)
  expect(actions.filter(action => action === 'ride.partner_confirmed')).toHaveLength(3)
  expect(actions.filter(action => action === 'ride.partner_confirmation_cleared')).toEqual([])
  expect(actions).toEqual(expect.arrayContaining(['ride.done', 'ride.cancelled']))
  expect(actions.some(action => action === 'ride.no_show' || action === 'ride.no_show_early')).toBe(true)
})

it('the check rejects the flag on every state except a handoff, including leaving handed_off while it stays true', async () => {
  const world = await office('pcf-check')
  const driver = await createDriver(world.dispatcher, {
    name: 'Marko Vozač',
    kind: 'own',
    phone: partnerPhone,
    email: 'pcf-check-driver@example.test',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(world.dispatcher, {
    registrationPlate: `ZG${Math.floor(Math.random() * 9000 + 1000)}AA`,
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const partner = await createPartner(world.dispatcher, { name: partnerName })

  async function rideIn(state: 'unassigned' | 'assigned' | 'accepted' | 'done' | 'no-show' | 'cancelled' | 'handed_off') {
    const hours = { 'unassigned': 4, 'assigned': 6, 'accepted': 8, 'done': 10, 'no-show': 12, 'cancelled': 14, 'handed_off': 16 }
    const recorded = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(hours[state]), state))
    if (state === 'unassigned' || state === 'cancelled') {
      if (state === 'cancelled')
        expect((await call('POST', `/api/rides/${recorded.ride.id}/cancel`, world.dispatcher, {})).status).toBe(200)
      return recorded.ride.id
    }
    if (state === 'handed_off') {
      await handOff(world.dispatcher, recorded.ride.id, partner.id)
      return recorded.ride.id
    }
    await updateDriver(world.admin, driver.id, { mustAccept: state === 'accepted' })
    await assignRide(world.dispatcher, {
      rideId: recorded.ride.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      version: await versionOf(recorded.ride.id),
    })
    if (state === 'accepted')
      await acceptRideByPhone(world.dispatcher, recorded.ride.id, {})
    if (state === 'done')
      expect((await call('POST', `/api/rides/${recorded.ride.id}/done`, world.dispatcher, {})).status).toBe(200)
    if (state === 'no-show')
      expect((await call('POST', `/api/rides/${recorded.ride.id}/no-show`, world.dispatcher, {})).status).toBe(200)
    return recorded.ride.id
  }

  for (const state of ['unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled'] as const) {
    const rideId = await rideIn(state)
    expect(await rideRow(rideId)).toMatchObject({ state, partner_confirmed: false })
    await expect(ownerPool.query(
      `update app.rides set partner_confirmed = true where id = $1`,
      [rideId],
    )).rejects.toMatchObject({ code: '23514', constraint: 'rides_partner_confirmed_handed_off' })
    expect((await rideRow(rideId)).partner_confirmed).toBe(false)
  }

  const handed = await rideIn('handed_off')
  await ownerPool.query(`update app.rides set partner_confirmed = true where id = $1`, [handed])
  expect((await rideRow(handed)).partner_confirmed).toBe(true)
  await expect(ownerPool.query(
    `update app.rides set state = 'cancelled', partner_id = null where id = $1`,
    [handed],
  )).rejects.toMatchObject({ code: '23514', constraint: 'rides_partner_confirmed_handed_off' })
  expect(await rideRow(handed)).toMatchObject({ state: 'handed_off', partner_confirmed: true })
})

it('tenant A cannot read or set the flag on tenant B\'s Ride', async () => {
  const left = await office('pcf-left')
  const right = await office('pcf-right')
  const partner = await createPartner(left.dispatcher, { name: partnerName, phone: partnerPhone })
  const recorded = await createTransfer(left.dispatcher, transferBody(left, hoursAhead(2)))
  await handOff(left.dispatcher, recorded.ride.id, partner.id)
  const version = await versionOf(recorded.ride.id)
  expect((await confirm(left.dispatcher, recorded.ride.id, version)).status).toBe(200)

  const refused = await unchanged(left.tenantId, recorded.ride.id, () => confirm(right.dispatcher, recorded.ride.id, version + 1))
  expect(refused.status).toBe(404)

  const seen = await withAppTenant(right.tenantId, async client =>
    (await client.query(`select partner_confirmed from app.rides where id = $1`, [recorded.ride.id])).rows)
  expect(seen).toEqual([])
  const written = await withAppTenant(right.tenantId, async (client) => {
    const result = await client.query(
      `update app.rides set partner_confirmed = false where id = $1 returning id`,
      [recorded.ride.id],
    )
    return result.rowCount
  })
  expect(written).toBe(0)
  expect((await rideRow(recorded.ride.id)).partner_confirmed).toBe(true)
})

it('client and partner history keep the plain handed-off state for a confirmed and an unconfirmed Ride', async () => {
  const world = await office('pcf-history')
  const partner = await createPartner(world.dispatcher, { name: partnerName })
  const waiting = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(2), 'Ana Anić'))
  const confirmed = await createTransfer(world.dispatcher, transferBody(world, hoursAhead(3), 'Ivo Ivić'))
  await handOff(world.dispatcher, waiting.ride.id, partner.id)
  await handOff(world.dispatcher, confirmed.ride.id, partner.id)
  expect((await confirm(world.dispatcher, confirmed.ride.id, await versionOf(confirmed.ride.id))).status).toBe(200)

  const clientHistory = await listClientRideHistory(world.dispatcher, world.client.id, {})
  const partnerHistory = await listPartnerRideHistory(world.dispatcher, partner.id, {})
  const states = (rides: { rideId: string, state: string }[]) =>
    rides.filter(ride => ride.rideId === waiting.ride.id || ride.rideId === confirmed.ride.id).map(ride => ride.state)
  expect(states(clientHistory.rides)).toEqual(['handed_off', 'handed_off'])
  expect(states(partnerHistory.rides)).toEqual(['handed_off', 'handed_off'])
  expect(JSON.stringify(clientHistory)).not.toContain('partnerConfirmed')
  expect(JSON.stringify(partnerHistory)).not.toContain('partnerConfirmed')
})
