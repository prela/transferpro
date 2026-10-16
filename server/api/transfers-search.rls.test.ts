import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, TRANSFER_SEARCH_LIMIT, TRANSFER_SEARCH_MAX_LENGTH, transferSearchSchema } from '../../shared'
import { createClient } from '../modules/clients'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import { createTransfer, searchTransfers } from '../modules/transfers'
import getTransferSearch from './transfers/search.get'

/**
 * GET /api/transfers/search. `q` matches a guest, a Client reference, or a
 * flight number on any day. Admin and dispatcher may read it. A driver is
 * 403. No session is 401. The query text is not a log line and not an audit
 * entry. Another Tenant's Transfer is not a result.
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
const password = 'transfer-search-http-password'
const zone = 'Europe/Zagreb'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers/search', getTransferSearch)
const callSearch = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'xsr-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'xsr-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'xsr-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'xsr-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'xsr-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'xsr-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'xsr-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'xsr-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'xsr-%'`)
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

function call(session: Headers | undefined, q?: string) {
  const url = new URL('http://localhost/api/transfers/search')
  if (q !== undefined)
    url.searchParams.set('q', q)
  return callSearch(new Request(url, { method: 'GET', headers: session }))
}

async function auditText(tenantId: string): Promise<string> {
  const result = await ownerPool.query<{ data: unknown }>(
    `select data from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return JSON.stringify(result.rows)
}

it('refuses a signed-out request and a driver, and a bad query keeps its text out of the response', async () => {
  const created = await tenant('xsr-role', 'Hana Admin')
  await addMember(created.tenantId, 'xsr-role-driver@example.test', 'Drago Driver', 'driver')
  await addMember(created.tenantId, 'xsr-role-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const driver = await signIn('xsr-role-driver@example.test')
  const dispatcher = await signIn('xsr-role-dispatcher@example.test')
  const query = 'Tajna Gošća'

  const unsigned = await call(undefined, query)
  expect(unsigned.status).toBe(401)
  expect(await unsigned.text()).not.toContain(query)
  await expect(searchTransfers(new Headers(), query)).rejects.toMatchObject({ statusCode: 401 })

  const refused = await call(driver, query)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(query)
  await expect(searchTransfers(driver, query)).rejects.toMatchObject({ statusCode: 403 })

  const blank = await call(dispatcher, '   ')
  expect(blank.status).toBe(400)
  expect(await blank.text()).not.toContain(query)
  await expect(searchTransfers(dispatcher, '   ')).rejects.toMatchObject({ statusCode: 400 })

  const missing = await call(dispatcher)
  expect(missing.status).toBe(400)

  const tooLong = `Q7-secret-query${'x'.repeat(TRANSFER_SEARCH_MAX_LENGTH)}`
  const over = await call(dispatcher, tooLong)
  expect(over.status).toBe(400)
  expect(await over.text()).not.toContain('Q7-secret-query')
  await expect(searchTransfers(dispatcher, tooLong)).rejects.toMatchObject({ statusCode: 400 })
})

it('finds a guest, a Client reference, and a flight on past, current, and future days', async () => {
  const created = await tenant('xsr-find', 'Hana Admin')
  await addMember(created.tenantId, 'xsr-find-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  const admin = await signIn('xsr-find-admin@example.test')
  const dispatcher = await signIn('xsr-find-dispatcher@example.test')
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka Dubrovnik', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Excelsior', kind: 'hotel' })

  const calendar = calendarDateInTimeZone(zone, new Date())
  const previous = addCalendarDays(calendar, -1)
  const next = addCalendarDays(calendar, 1)

  async function record(input: {
    guestName: string
    wall: string
    flightNumber?: string
    clientReference?: string
    tabla?: string
  }) {
    const pickupAt = instantFromWallClock(input.wall, zone).toISOString()
    const recorded = await createTransfer(admin, {
      clientId: client.id,
      pickupAt,
      startLocationId: start.id,
      endLocationId: end.id,
      passengerCount: 2,
      guestName: input.guestName,
      flightNumber: input.flightNumber,
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      clientReference: input.clientReference,
      tabla: input.tabla,
    })
    return { rideId: recorded.ride.id, pickupAt }
  }

  const guestYesterday = await record({ guestName: 'Anić Xsr', wall: `${previous}T12:00` })
  const guestToday = await record({ guestName: 'Anić Xsr', wall: `${calendar}T12:00` })
  // Before the 05:00 start, so the board day is the previous calendar date.
  const guestEarly = await record({ guestName: 'Anić Xsr', wall: `${next}T04:30` })
  const guestTomorrow = await record({ guestName: 'Anić Xsr', wall: `${next}T12:00` })

  const referenceYesterday = await record({ guestName: 'Referenca Jučer', wall: `${previous}T11:00`, clientReference: 'REF-XSR-19' })
  const referenceToday = await record({ guestName: 'Referenca Danas', wall: `${calendar}T11:00`, clientReference: 'REF-XSR-19' })
  const referenceTomorrow = await record({ guestName: 'Referenca Sutra', wall: `${next}T11:00`, clientReference: 'REF-XSR-19' })

  const flightYesterday = await record({ guestName: 'Let Jučer', wall: `${previous}T16:00`, flightNumber: 'OU919' })
  const flightToday = await record({ guestName: 'Let Danas', wall: `${calendar}T16:00`, flightNumber: 'OU919' })
  const flightTomorrow = await record({ guestName: 'Let Sutra', wall: `${next}T16:00`, flightNumber: 'OU919' })

  await record({ guestName: 'Tabla Samo', wall: `${calendar}T18:00`, tabla: 'TABLA-ONLY' })

  const boundIds: string[] = []
  for (let index = 0; index <= TRANSFER_SEARCH_LIMIT; index++) {
    const total = 6 * 60 + index
    const hour = String(Math.floor(total / 60)).padStart(2, '0')
    const minute = String(total % 60).padStart(2, '0')
    const bound = await record({ guestName: 'Bound Xsr', wall: `${calendar}T${hour}:${minute}` })
    boundIds.push(bound.rideId)
  }

  const foreign = await tenant('xsr-other', 'Iva Admin')
  const outsider = await signIn('xsr-other-admin@example.test')
  const foreignClient = await createClient(outsider, { name: 'Strana Agencija', kind: 'agency' })
  const foreignStart = await createLocation(outsider, { name: 'Strani Početak', kind: 'hotel' })
  const foreignEnd = await createLocation(outsider, { name: 'Strani Kraj', kind: 'hotel' })
  const foreignRide = await createTransfer(outsider, {
    clientId: foreignClient.id,
    pickupAt: instantFromWallClock(`${calendar}T12:00`, zone).toISOString(),
    startLocationId: foreignStart.id,
    endLocationId: foreignEnd.id,
    passengerCount: 1,
    guestName: 'Anić Xsr',
    price: 10,
    payment: 'cash',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
  })

  const audits = await auditText(created.tenantId)
  const found = transferSearchSchema.parse(await searchTransfers(admin, '  anić xsr  '))
  expect(transferSearchSchema.parse(await searchTransfers(dispatcher, 'anić xsr'))).toEqual(found)
  expect(await auditText(created.tenantId)).toBe(audits)
  expect(audits).not.toContain('Anić Xsr')
  expect(audits).not.toContain('REF-XSR-19')
  expect(audits).not.toContain('OU919')

  expect(found.results.map(row => row.rideId)).toEqual([
    guestYesterday.rideId,
    guestToday.rideId,
    guestEarly.rideId,
    guestTomorrow.rideId,
  ])
  expect(found.results.map(row => row.operationalDay)).toEqual([previous, calendar, calendar, next])
  expect(found.results[0]).toMatchObject({
    pickupAt: guestYesterday.pickupAt,
    guestName: 'Anić Xsr',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    clientName: 'Agencija Mora',
    state: 'unassigned',
  })
  expect(JSON.stringify(found)).not.toContain(foreignRide.ride.id)

  const byReference = transferSearchSchema.parse(await searchTransfers(dispatcher, 'ref-xsr-19'))
  expect(byReference.results.map(row => row.rideId)).toEqual([
    referenceYesterday.rideId,
    referenceToday.rideId,
    referenceTomorrow.rideId,
  ])
  expect(byReference.results.map(row => row.operationalDay)).toEqual([previous, calendar, next])

  const byFlight = transferSearchSchema.parse(await searchTransfers(admin, 'ou919'))
  expect(byFlight.results.map(row => row.rideId)).toEqual([
    flightYesterday.rideId,
    flightToday.rideId,
    flightTomorrow.rideId,
  ])

  expect(transferSearchSchema.parse(await searchTransfers(admin, 'tabla-only')).results).toEqual([])
  expect(transferSearchSchema.parse(await searchTransfers(admin, 'agencija mora')).results).toEqual([])
  expect(transferSearchSchema.parse(await searchTransfers(admin, '%')).results).toEqual([])
  expect(transferSearchSchema.parse(await searchTransfers(admin, '_')).results).toEqual([])

  const bounded = transferSearchSchema.parse(await searchTransfers(admin, 'bound xsr'))
  expect(bounded.results.map(row => row.rideId)).toEqual(boundIds.slice(0, TRANSFER_SEARCH_LIMIT))

  const foreignFound = transferSearchSchema.parse(await searchTransfers(outsider, 'anić xsr'))
  expect(foreignFound.results.map(row => row.rideId)).toEqual([foreignRide.ride.id])
  expect(JSON.stringify(foreignFound)).not.toContain(guestToday.rideId)

  const http = await call(admin, 'anić xsr')
  expect(http.status).toBe(200)
  expect(transferSearchSchema.parse(await http.json())).toEqual(found)

  const logged: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logged.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    await searchTransfers(admin, 'REF-XSR-19')
  }
  finally {
    process.stdout.write = write
  }
  expect(logged.join('')).not.toContain('REF-XSR-19')
  expect(await auditText(created.tenantId)).not.toContain('REF-XSR-19')
  expect(await auditText(foreign.tenantId)).not.toContain('Anić Xsr')
})
