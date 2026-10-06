import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { calendarDateInTimeZone } from '../../shared'
import { createClient } from '../modules/clients'
import { archiveLocation, createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
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
    pickupAt: '2026-10-06T22:30:00.000Z',
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
    pickupAt: '2026-10-06T22:30:00.000Z',
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
    pickupAt: '2026-10-06T12:00:00.000Z',
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

  // 22:30 UTC on 6 October 2026 is 00:30 on 7 October in Zagreb (CEST, UTC+2).
  const added = await call('POST', '/api/transfers', dispatcher, {
    clientId: client.id,
    pickupAt: '2026-10-06T22:30:00.000Z',
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
  })
  expect(added.status).toBe(200)
  const row = await added.json()
  expect(row.transfer).toMatchObject({
    clientId: client.id,
    pickupAt: '2026-10-06T22:30:00.000Z',
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
  })
  expect(row.ride).toEqual({
    id: expect.any(String),
    transferId: row.transfer.id,
    state: 'unassigned',
    driverId: null,
    vehicleId: null,
  })
  expect(await rideCount(created.tenantId, row.transfer.id)).toBe(1)

  const sameDay = await call('GET', '/api/transfers?date=2026-10-06', admin)
  expect(sameDay.status).toBe(200)
  expect(await sameDay.json()).toEqual({ date: '2026-10-06', rides: [] })

  const nextDay = await call('GET', '/api/transfers?date=2026-10-07', dispatcher)
  expect(nextDay.status).toBe(200)
  const listed = await nextDay.json()
  expect(listed.date).toBe('2026-10-07')
  expect(listed.rides).toEqual([
    expect.objectContaining({
      rideId: row.ride.id,
      transferId: row.transfer.id,
      state: 'unassigned',
      driverId: null,
      vehicleId: null,
      guestName: guest,
      airportMark: false,
      price: '42.50',
    }),
  ])

  const today = await call('GET', '/api/transfers', admin)
  expect(today.status).toBe(200)
  expect((await today.json()).date).toBe(calendarDateInTimeZone('Europe/Zagreb', new Date()))

  const audit = await ownerPool.query<{ data: unknown }>(
    `select data from app.audit_entry where tenant_id = $1 and action::text = 'transfer.created'`,
    [created.tenantId],
  )
  expect(audit.rows).toHaveLength(1)
  const auditText = JSON.stringify(audit.rows[0]?.data)
  expect(auditText).not.toContain(guest)
  expect(auditText).not.toContain(flight)
  expect(auditText).not.toContain(note)
  expect(auditText).not.toContain('42.50')
  expect(audit.rows[0]?.data).toMatchObject({
    transferId: row.transfer.id,
    rideId: row.ride.id,
    clientId: client.id,
    startLocationId: start.id,
    endLocationId: end.id,
  })
})
