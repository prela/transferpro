import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createClient } from '../modules/clients'
import { createLocation } from '../modules/locations'
import { createPartner } from '../modules/partners'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { createTransfer } from '../modules/transfers'
import postHandOff from './rides/[id]/hand-off.post'
import patchTransfer from './transfers/[id].patch'

/**
 * A Transfer correction clears a Partner confirmation (ADR-0062).
 * The route is the proof: the flag, the audit entry, and the count.
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
const password = 'confirmation-clear-http-password'
const partnerName = 'Mora Clear PCC'
const partnerPhone = '+38591111572'
const guest = 'Ana Anić'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '').replace(/^\/api\/transfers/, '')
  if (event.method !== 'PATCH')
    return new Response('Not Found', { status: 404 })
  event.context.params = { id: pathOnly.split('/').filter(Boolean).at(-1) ?? '' }
  return patchTransfer(event)
})
app.use('/api/rides', (event) => {
  const pathOnly = (event.path.split('?')[0] ?? '/').replace(/\/$/, '')
  const marker = '/api/rides/'
  const relative = pathOnly.includes(marker)
    ? pathOnly.slice(pathOnly.indexOf(marker) + marker.length)
    : pathOnly.replace(/^\//, '')
  const [id, action] = relative.split('/')
  event.context.params = { id: id ?? '' }
  if (action === 'hand-off' && event.method === 'POST')
    return postHandOff(event)
  return new Response('Not Found', { status: 404 })
})
const callHttp = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.partners where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'pcc-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'pcc-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'pcc-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'pcc-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'pcc-%'`)
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

function call(method: string, path: string, session: Headers | undefined, body?: unknown) {
  const headers = new Headers(session)
  if (body !== undefined)
    headers.set('content-type', 'application/json')
  return callHttp(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

async function office(slug: string) {
  const created = await tenant(slug)
  const dispatcherId = await addMember(created.tenantId, `${slug}-dispatcher@example.test`, 'Dino Dispatcher', 'dispatcher')
  const dispatcher = await signIn(`${slug}-dispatcher@example.test`)
  const client = await createClient(dispatcher, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Polazak Proba', kind: 'airport' })
  const end = await createLocation(dispatcher, { name: 'Dolazak Proba', kind: 'hotel' })
  const otherStart = await createLocation(dispatcher, { name: 'Drugi polazak', kind: 'address' })
  const otherEnd = await createLocation(dispatcher, { name: 'Drugi dolazak', kind: 'hotel' })
  const partner = await createPartner(dispatcher, { name: partnerName, phone: partnerPhone })
  return { ...created, dispatcherId, dispatcher, client, start, end, otherStart, otherEnd, partner }
}

function hoursAhead(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

type World = Awaited<ReturnType<typeof office>>

function booking(world: World, pickupAt: string, guestName = guest) {
  return {
    clientId: world.client.id,
    pickupAt,
    startLocationId: world.start.id,
    endLocationId: world.end.id,
    passengerCount: 1,
    guestName,
    flightNumber: 'OU384',
    price: 10,
    payment: 'cash' as const,
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    tabla: '',
  }
}

async function versionOf(rideId: string): Promise<number> {
  const result = await ownerPool.query<{ version: string }>(
    `select t.version::text
     from app.transfers as t
     join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
     where r.id = $1`,
    [rideId],
  )
  return Number(result.rows[0]?.version ?? 0)
}

async function rideFlag(rideId: string) {
  const result = await ownerPool.query<{ partner_confirmed: boolean, state: string }>(
    `select partner_confirmed, state from app.rides where id = $1`,
    [rideId],
  )
  const row = result.rows[0]
  if (!row)
    throw new Error('missing ride')
  return row
}

async function correctionAudits(tenantId: string, rideId: string) {
  const result = await ownerPool.query<{ action: string, actor_user_id: string, data: unknown }>(
    `select action, actor_user_id, data
     from app.audit_entry
     where tenant_id = $1
       and data->>'rideId' = $2
       and action::text in ('transfer.corrected', 'ride.partner_confirmation_cleared')
     order by occurred_at, action`,
    [tenantId, rideId],
  )
  return result.rows
}

async function recordRide(world: World, pickupAt: string, extra: Record<string, unknown> = {}) {
  return createTransfer(world.dispatcher, {
    ...booking(world, pickupAt),
    externalId: crypto.randomUUID(),
    ...extra,
  })
}

async function agree(world: World, rideId: string) {
  const response = await call('POST', `/api/rides/${rideId}/hand-off`, world.dispatcher, {
    partnerId: world.partner.id,
    version: await versionOf(rideId),
    partnerConfirmed: true,
  })
  expect(response.status).toBe(200)
  expect(await rideFlag(rideId)).toMatchObject({ state: 'handed_off', partner_confirmed: true })
}

async function correct(world: World, transferId: string, rideId: string, patch: Record<string, unknown>, version?: number) {
  const stored = booking(world, '')
  const response = await call('PATCH', `/api/transfers/${transferId}`, world.dispatcher, {
    ...stored,
    pickupAt: hoursAhead(3),
    ...patch,
    version: version ?? await versionOf(rideId),
  })
  return response
}

it('clears a confirmed handoff for each agreed field and writes the entry beside the correction', async () => {
  const world = await office('pcc-fields')
  const laterPickup = hoursAhead(30)
  const cases: Record<string, unknown>[] = [
    { pickupAt: laterPickup },
    { startLocationId: world.otherStart.id },
    { endLocationId: world.otherEnd.id },
    { flightNumber: 'OU392' },
    { passengerCount: 3 },
    { luggageCount: 2 },
    { childSeatCount: 1 },
  ]
  for (const [index, patch] of cases.entries()) {
    const pickupAt = hoursAhead(2 + index)
    const guestName = `Gost ${index}`
    const recorded = await recordRide(world, pickupAt, { guestName })
    await agree(world, recorded.ride.id)
    const saved = await correct(world, recorded.transfer.id, recorded.ride.id, {
      ...patch,
      guestName,
      pickupAt: typeof patch.pickupAt === 'string' ? patch.pickupAt : pickupAt,
    })
    expect(saved.status).toBe(200)
    const text = await saved.text()
    expect(text).not.toContain(partnerName)
    expect(text).not.toContain(partnerPhone)
    expect(JSON.parse(text)).toMatchObject({ partnerConfirmationsCleared: 1 })
    expect(await rideFlag(recorded.ride.id)).toMatchObject({ state: 'handed_off', partner_confirmed: false })
    const audits = await correctionAudits(world.tenantId, recorded.ride.id)
    expect(JSON.stringify(audits)).not.toContain(partnerName)
    expect(JSON.stringify(audits)).not.toContain(partnerPhone)
    expect(audits).toContainEqual({
      action: 'transfer.corrected',
      actor_user_id: world.dispatcherId,
      data: expect.objectContaining({ rideId: recorded.ride.id }),
    })
    expect(audits).toContainEqual({
      action: 'ride.partner_confirmation_cleared',
      actor_user_id: world.dispatcherId,
      data: { rideId: recorded.ride.id, partnerId: world.partner.id, fields: ['partnerConfirmed'] },
    })
  }
})

it('leaves the confirmation when the note, the guest, or only the flight spacing changes', async () => {
  const world = await office('pcc-quiet')
  const quiet = [
    { note: 'Nova napomena' },
    { guestName: 'Iva Ivić' },
    { flightNumber: 'ou384' },
  ]
  for (const [index, patch] of quiet.entries()) {
    const pickupAt = hoursAhead(2 + index)
    const recorded = await recordRide(world, pickupAt)
    await agree(world, recorded.ride.id)
    const saved = await correct(world, recorded.transfer.id, recorded.ride.id, {
      ...patch,
      pickupAt,
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ partnerConfirmationsCleared: 0 })
    expect(await rideFlag(recorded.ride.id)).toMatchObject({ partner_confirmed: true })
    const audits = await correctionAudits(world.tenantId, recorded.ride.id)
    expect(audits.map(row => row.action)).toEqual(['transfer.corrected'])
  }
})

it('writes no clearing entry when the handoff was still waiting', async () => {
  const world = await office('pcc-wait')
  const pickupAt = hoursAhead(2)
  const recorded = await recordRide(world, pickupAt)
  const handed = await call('POST', `/api/rides/${recorded.ride.id}/hand-off`, world.dispatcher, {
    partnerId: world.partner.id,
    version: await versionOf(recorded.ride.id),
  })
  expect(handed.status).toBe(200)
  expect(await rideFlag(recorded.ride.id)).toMatchObject({ partner_confirmed: false })
  const saved = await correct(world, recorded.transfer.id, recorded.ride.id, {
    passengerCount: 4,
    pickupAt,
  })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ partnerConfirmationsCleared: 0 })
  expect(await rideFlag(recorded.ride.id)).toMatchObject({ state: 'handed_off', partner_confirmed: false })
  const audits = await correctionAudits(world.tenantId, recorded.ride.id)
  expect(audits.map(row => row.action)).toEqual(['transfer.corrected'])
})

it('judges each extra vehicle on its own', async () => {
  const world = await office('pcc-group')
  const pickup = hoursAhead(2)
  const clearedPickup = hoursAhead(4)
  const untouchedPickup = hoursAhead(6)
  const main = await recordRide(world, pickup, { passengerCount: 4, price: 40, guestName: 'Ana Grupno' })
  const cleared = await recordRide(world, clearedPickup, {
    price: 0,
    guestName: 'Iva Dodatna',
    mainTransferId: main.transfer.id,
    groupPassengerCount: 9,
    mainVersion: 0,
  })
  const untouched = await recordRide(world, untouchedPickup, {
    price: 0,
    guestName: 'Lea Ista',
    flightNumber: 'OU392',
    mainTransferId: main.transfer.id,
  })
  await agree(world, cleared.ride.id)
  await agree(world, untouched.ride.id)
  const untouchedVersion = await versionOf(untouched.ride.id)
  const saved = await correct(world, main.transfer.id, main.ride.id, {
    flightNumber: 'OU392',
    passengerCount: 4,
    price: 40,
    guestName: 'Ana Grupno',
    pickupAt: pickup,
    applyToExtraVehicles: true,
  })
  expect(saved.status).toBe(200)
  const text = await saved.text()
  expect(text).not.toContain(partnerName)
  expect(text).not.toContain(partnerPhone)
  expect(JSON.parse(text)).toMatchObject({ partnerConfirmationsCleared: 1 })
  expect(await rideFlag(cleared.ride.id)).toMatchObject({ partner_confirmed: false })
  expect(await rideFlag(untouched.ride.id)).toMatchObject({ partner_confirmed: true })
  expect(await versionOf(untouched.ride.id)).toBe(untouchedVersion)
  expect(await correctionAudits(world.tenantId, cleared.ride.id)).toContainEqual({
    action: 'ride.partner_confirmation_cleared',
    actor_user_id: world.dispatcherId,
    data: { rideId: cleared.ride.id, partnerId: world.partner.id, fields: ['partnerConfirmed'] },
  })
  expect(await correctionAudits(world.tenantId, untouched.ride.id)).toEqual([])
  // Storing the group's ordered count already wrote transfer.corrected.
  // This save adds the flight correction and no clearing entry: the main Ride was not handed off.
  const mainAudits = await correctionAudits(world.tenantId, main.ride.id)
  expect(mainAudits.filter(row => row.action === 'ride.partner_confirmation_cleared')).toEqual([])
  expect(mainAudits.filter(row => row.action === 'transfer.corrected').length).toBeGreaterThan(0)
})

it('a refused correction clears nothing', async () => {
  const world = await office('pcc-stale')
  const pickupAt = hoursAhead(2)
  const recorded = await recordRide(world, pickupAt)
  await agree(world, recorded.ride.id)
  const version = await versionOf(recorded.ride.id)
  const before = await correctionAudits(world.tenantId, recorded.ride.id)
  const saved = await correct(world, recorded.transfer.id, recorded.ride.id, {
    passengerCount: 3,
    pickupAt,
  }, version + 3)
  expect(saved.status).toBe(409)
  expect(await rideFlag(recorded.ride.id)).toMatchObject({ partner_confirmed: true })
  expect(await versionOf(recorded.ride.id)).toBe(version)
  expect(await correctionAudits(world.tenantId, recorded.ride.id)).toEqual(before)
})
