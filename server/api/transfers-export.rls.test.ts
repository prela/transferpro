import type { PaymentMethod, TenantRole } from '../../shared'
import { Buffer } from 'node:buffer'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../../shared'
import { configureLogger } from '../core/index'
import { captureLogs } from '../core/testing'
import { createClient } from '../modules/clients'
import { createDriver } from '../modules/drivers'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest, updateUserLocale } from '../modules/tenancy'
import { assignRide, cancelRide, createTransfer, exportRides } from '../modules/transfers'
import { createVehicle } from '../modules/vehicles'
import getRideExport from './transfers/export.get'

/**
 * GET /api/transfers/export. Admin and dispatcher download the file.
 * A driver is 403. No session is 401. A bad range is 400 before a session
 * opens. Tenant B's Rides stay out. A pickup at 02:00 stays on its calendar
 * day. The log names the member, the range, and the row count.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')
configureLogger('info')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const password = 'ride-export-http-password'
const zone = 'Europe/Zagreb'
const guest = 'Ana Anić'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/transfers/export', getRideExport)
const callExport = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.ride_alert where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.roster where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.drivers where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'rxc-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'rxc-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'rxc-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'rxc-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'rxc-%'`)
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

function call(session: Headers | undefined, from?: string, to?: string) {
  const url = new URL('http://localhost/api/transfers/export')
  if (from !== undefined)
    url.searchParams.set('from', from)
  if (to !== undefined)
    url.searchParams.set('to', to)
  return callExport(new Request(url, { method: 'GET', headers: session }))
}

async function auditCount(tenantId: string): Promise<number> {
  const result = await ownerPool.query<{ count: string }>(
    `select count(*) from app.audit_entry where tenant_id = $1`,
    [tenantId],
  )
  return Number(result.rows[0]?.count)
}

/** The version stored now. The assign body requires it (ADR-0046). */
async function transferVersion(transferId: string): Promise<number> {
  const result = await ownerPool.query<{ version: number }>(
    `select version from app.transfers where id = $1`,
    [transferId],
  )
  return Number(result.rows[0]?.version ?? 0)
}

function transferBody(clientId: string, startId: string, endId: string, pickupAt: string, price: number, payment: PaymentMethod) {
  return {
    clientId,
    pickupAt,
    startLocationId: startId,
    endLocationId: endId,
    passengerCount: 1,
    guestName: guest,
    price,
    payment,
    airportMark: true,
    luggageCount: 0,
    childSeatCount: 0,
  }
}

it('answers 400 for a bad range before a session, and 401 when the range is valid', async () => {
  const reversed = await call(undefined, '2026-10-19', '2026-10-18')
  const tooLong = await call(undefined, '2024-01-01', '2025-01-01')
  const notADate = await call(undefined, '2026-02-31', '2026-03-01')
  expect(reversed.status).toBe(400)
  expect(tooLong.status).toBe(400)
  expect(notADate.status).toBe(400)
  const reversedBody = await reversed.text()
  const tooLongBody = await tooLong.text()
  expect(reversedBody).toBe(tooLongBody)
  expect(await notADate.text()).toBe(tooLongBody)
  expect(reversedBody).not.toContain('2026-10-19')
  expect((await call(undefined, '2026-10-01', '2026-10-31')).status).toBe(401)
})

it('a driver is 403, and an admin and a dispatcher download the calendar day including 02:00', async () => {
  const created = await tenant('rxc-day', 'Hana Admin')
  const dispatcherUserId = await addMember(created.tenantId, 'rxc-day-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(created.tenantId, 'rxc-day-driver@example.test', 'Drago Driver', 'driver')
  const dispatcher = await signIn('rxc-day-dispatcher@example.test')
  const admin = await signIn('rxc-day-admin@example.test')
  const driver = await signIn('rxc-day-driver@example.test')
  const client = await createClient(dispatcher, { name: '=Čekić', kind: 'agency' })
  const start = await createLocation(dispatcher, { name: 'Čačak; 1', kind: 'airport', iata: 'DBV' })
  const end = await createLocation(dispatcher, { name: 'Hotel "Park"', kind: 'hotel' })
  const person = await createDriver(dispatcher, {
    name: '+Marko',
    kind: 'own',
    phone: '+385911113360',
    drivingLicenceExpiresOn: '2030-01-01',
    transportLicenceExpiresOn: '2030-06-01',
  })
  const vehicle = await createVehicle(dispatcher, {
    registrationPlate: '@ZG1',
    kind: 'fixed',
    registrationExpiresOn: '2030-01-01',
    technicalInspectionExpiresOn: '2030-01-01',
    insuranceExpiresOn: '2030-01-01',
  })
  const day = calendarDateInTimeZone(zone, new Date())
  const previous = addCalendarDays(day, -1)
  const early = await createTransfer(dispatcher, transferBody(
    client.id,
    start.id,
    end.id,
    instantFromWallClock(`${day}T02:00`, zone).toISOString(),
    42.5,
    'invoice_to_agency',
  ))
  const assigned = await createTransfer(dispatcher, transferBody(
    client.id,
    start.id,
    end.id,
    instantFromWallClock(`${day}T15:00`, zone).toISOString(),
    10,
    'cash',
  ))
  const dropped = await createTransfer(dispatcher, transferBody(
    client.id,
    start.id,
    end.id,
    instantFromWallClock(`${day}T18:00`, zone).toISOString(),
    0,
    'cash',
  ))
  await assignRide(dispatcher, {
    rideId: assigned.ride.id,
    driverId: person.id,
    vehicleId: vehicle.id,
    version: await transferVersion(assigned.transfer.id),
  })
  await cancelRide(dispatcher, dropped.ride.id, {})

  const refused = await call(driver, day, day)
  expect(refused.status).toBe(403)
  const refusedBody = await refused.text()
  expect(refusedBody).not.toContain('Čekić')
  expect(refusedBody).not.toContain(guest)

  const before = await auditCount(created.tenantId)
  const file = await call(dispatcher, day, day)
  expect(file.status).toBe(200)
  expect(file.headers.get('content-type')).toContain('text/csv')
  expect(file.headers.get('cache-control')).toBe('no-store')
  expect(file.headers.get('content-disposition')).toBe(`attachment; filename="rides-${day}-${day}.csv"`)
  const bytes = Buffer.from(await file.arrayBuffer())
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]))
  const body = bytes.toString('utf8')
  const lines = body.replace(/^\uFEFF/, '').split('\r\n')
  const [year, month, date] = day.split('-')
  expect(lines[0]).toBe('Datum;Vrijeme;Polazište;Odredište;Naručitelj;Vozač;Registarska oznaka;Cijena;Plaćanje;Stanje')
  expect(lines[1]).toContain(`${date}.${month}.${year};02:00;`)
  expect(lines[1]).toContain('"Čačak; 1 (DBV)";"Hotel ""Park""";\'=Čekić;;;42,50;Račun agenciji;Nedodijeljeno')
  expect(lines[2]).toContain(';15:00;')
  expect(lines[2]).toContain(';\'+Marko;\'@ZG1;10,00;Gotovina;Dodijeljeno')
  expect(lines[3]).toContain(';18:00;')
  expect(lines[3]).toContain(';;;0,00;Gotovina;Otkazano')
  expect(lines[4]).toBe('')
  expect(body).not.toContain(guest)
  expect(await auditCount(created.tenantId)).toBe(before)

  const yesterday = await call(admin, previous, previous)
  expect(yesterday.status).toBe(200)
  const yesterdayBody = await yesterday.text()
  expect(yesterdayBody).not.toContain('Čekić')
  expect(yesterdayBody.replace(/^\uFEFF/, '').startsWith('Datum;')).toBe(true)

  const logs = captureLogs()
  const exported = await exportRides(dispatcher, { from: day, to: day }, logs.logger)
  expect(exported.filename).toBe(`rides-${day}-${day}.csv`)
  expect(logs.lines()).toEqual([
    expect.objectContaining({
      event: 'rides.exported',
      userId: dispatcherUserId,
      from: day,
      to: day,
      rowCount: 3,
    }),
  ])
  const logged = JSON.stringify(logs.lines())
  expect(logged).not.toContain('Čekić')
  expect(logged).not.toContain('Marko')
  expect(logged).not.toContain(guest)
  expect(early.ride.id).toEqual(expect.any(String))
})

it('keeps Tenant B out of Tenant A, and follows the user locale', async () => {
  const firmA = await tenant('rxc-a', 'Hana Admin')
  const firmB = await tenant('rxc-b', 'Iva Admin')
  await addMember(firmA.tenantId, 'rxc-a-dispatcher@example.test', 'Dino Dispatcher', 'dispatcher')
  await addMember(firmB.tenantId, 'rxc-b-dispatcher@example.test', 'Ema Dispatcher', 'dispatcher')
  const officeA = await signIn('rxc-a-dispatcher@example.test')
  const officeB = await signIn('rxc-b-dispatcher@example.test')
  const day = calendarDateInTimeZone(zone, new Date())
  const pickupAt = instantFromWallClock(`${day}T11:00`, zone).toISOString()

  const clientA = await createClient(officeA, { name: 'Agencija A', kind: 'agency' })
  const startA = await createLocation(officeA, { name: 'Polazište A', kind: 'other' })
  const endA = await createLocation(officeA, { name: 'Odredište A', kind: 'hotel' })
  await createTransfer(officeA, transferBody(clientA.id, startA.id, endA.id, pickupAt, 8, 'card'))

  const clientB = await createClient(officeB, { name: 'Skriveni klijent B', kind: 'agency' })
  const startB = await createLocation(officeB, { name: 'Skriveno mjesto B', kind: 'other' })
  const endB = await createLocation(officeB, { name: 'Hotel B', kind: 'hotel' })
  await createTransfer(officeB, transferBody(clientB.id, startB.id, endB.id, pickupAt, 9, 'cash'))

  const fromA = await call(officeA, day, day)
  expect(fromA.status).toBe(200)
  const textA = await fromA.text()
  expect(textA).toContain('Agencija A')
  expect(textA).toContain('Kartica')
  expect(textA).not.toContain('Skriveni klijent B')
  expect(textA).not.toContain('Skriveno mjesto B')

  await updateUserLocale(officeA, 'en')
  const english = await call(officeA, day, day)
  const textEn = await english.text()
  expect(textEn.replace(/^\uFEFF/, '').startsWith('Date;Time;Pickup;Drop-off;Client;Driver;Registration plate;Price;Payment;Status\r\n')).toBe(true)
  expect(textEn).toContain('Card')
  expect(textEn).toContain('Unassigned')
  expect(textEn).not.toContain('Skriveni klijent B')
})
