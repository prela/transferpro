import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chooseActiveTenant, closeTenantRuntime, readSessionShell, switchActiveTenant, TenantAccessError, updateUserLocale } from '..'
import { instantFromWallClock, operationalDateInTimeZone } from '../../../../shared/date'
import { parseAppEnv } from '../../../core/index'
import { closeDriverHoldingRides, driverHasHoldingRide } from '../../transfers'
import { insertCredentialMember, insertMembership } from '../testing'
import { createAuth } from './auth'
import { createTenant } from './create-tenant'
import { setHoldingRideQuery } from './holding-ride'

/**
 * Session boundary (ADR-0057): twelve hours for the office, a Driver
 * refused without a holding Ride, another Tenant's Ride ignored, the
 * end of that Ride, and the sixteen-hour cap. Rows are the observation.
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const databaseUrl = required(process.env.DATABASE_URL, 'DATABASE_URL')
const authDatabaseUrl = required(process.env.AUTH_DATABASE_URL, 'AUTH_DATABASE_URL')
const ownerUrl = required(process.env.DATABASE_MIGRATE_URL, 'DATABASE_MIGRATE_URL')
const baseUrl = required(process.env.BETTER_AUTH_URL, 'BETTER_AUTH_URL')
const password = 'slice491-session-password'

const env = parseAppEnv({
  DATABASE_URL: databaseUrl,
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: required(process.env.QUEUE_DATABASE_URL, 'QUEUE_DATABASE_URL'),
  PLATFORM_DATABASE_URL: required(process.env.PLATFORM_DATABASE_URL, 'PLATFORM_DATABASE_URL'),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: baseUrl,
  NODE_ENV: 'test',
})

const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: ownerUrl })
const auth = createAuth(env)

const slugs: string[] = []
const emails: string[] = []

function stamp(label: string): { slug: string, email: string } {
  const suffix = crypto.randomUUID()
  const slug = `slice491-${label}-${suffix}`
  const email = `slice491-${label}-${suffix}@example.test`
  slugs.push(slug)
  emails.push(email)
  return { slug, email }
}

beforeAll(() => {
  setHoldingRideQuery(driverHasHoldingRide)
})

afterAll(async () => {
  for (const slug of slugs)
    await removeTenant(slug)
  for (const email of emails)
    await removeUser(email)
  await closeDriverHoldingRides()
  await auth.close()
  await closeTenantRuntime()
  await authPool.end()
  await appPool.end()
  await ownerPool.end()
})

async function openTenant(label: string): Promise<{ tenantId: string, email: string, userId: string }> {
  const named = stamp(label)
  const created = await createTenant({
    name: `Slice 491 ${label}`,
    slug: named.slug,
    adminEmail: named.email,
    adminName: `Admin ${label}`,
    password,
    authDatabaseUrl,
    migrateDatabaseUrl: ownerUrl,
  })
  return { tenantId: created.tenantId, email: named.email, userId: created.adminUserId }
}

async function openMember(tenantId: string, role: 'dispatcher' | 'driver', label: string): Promise<{ email: string, userId: string }> {
  const named = stamp(label)
  const userId = await insertCredentialMember(authPool, tenantId, {
    email: named.email,
    name: `Member ${label}`,
    password,
    role,
  })
  return { email: named.email, userId }
}

async function signIn(email: string): Promise<Headers> {
  const response = await auth.auth.handler(new Request(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': baseUrl },
    body: JSON.stringify({ email, password }),
  }))
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers.getSetCookie().find(part => part.includes('session_token'))
  if (!cookie)
    throw new Error('sign-in did not set a session cookie')
  return new Headers({ cookie: cookie.split(';')[0] ?? '' })
}

async function sessionLife(userId: string): Promise<number> {
  const result = await authPool.query<{ life: number }>(
    `select extract(epoch from (expires_at - created_at))::float as life
     from auth.session where user_id = $1 order by created_at desc limit 1`,
    [userId],
  )
  const life = result.rows[0]?.life
  if (life === undefined)
    throw new Error('session row is missing')
  return life
}

async function ageSession(userId: string, interval: string): Promise<void> {
  await authPool.query(
    `update auth.session set created_at = now() - $2::interval where user_id = $1`,
    [userId, interval],
  )
}

function expectHours(life: number, hours: number) {
  expect(life).toBeGreaterThan((hours - 0.5) * 60 * 60)
  expect(life).toBeLessThan((hours + 0.5) * 60 * 60)
}

async function withTenant<T>(tenantId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** A pickup already past, on the operational day that contains now. */
function pastPickupOnThisOperationalDay(): Date {
  const zone = 'Europe/Zagreb'
  const now = new Date()
  const day = operationalDateInTimeZone(zone, now, 5)
  const start = instantFromWallClock(`${day}T05:00`, zone)
  const candidate = new Date(Math.max(start.getTime() + 1000, now.getTime() - 60_000))
  if (candidate.getTime() >= now.getTime())
    return new Date(now.getTime() - 1000)
  return candidate
}

async function seedAssignedRide(tenantId: string, userId: string, email: string, pickup: Date): Promise<string> {
  const plate = `ZG${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`
  return withTenant(tenantId, async (client) => {
    const clientRow = await client.query<{ id: string }>(
      `insert into app.clients (name, kind) values ('Agencija Sesija', 'agency') returning id`,
    )
    const start = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Polazak Sesija', 'address') returning id`,
    )
    const end = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Dolazak Sesija', 'hotel') returning id`,
    )
    const existing = await client.query<{ id: string }>(
      `select id from app.drivers where member_user_id = $1`,
      [userId],
    )
    const driver = existing.rows[0]
      ? existing
      : await client.query<{ id: string }>(
          `insert into app.drivers (
             name, kind, phone, email, member_user_id, driving_licence_expires_on, transport_licence_expires_on, must_accept
           ) values ('Vozač Sesija', 'own', $1, $2, $3, '2030-01-01', '2030-01-01', false) returning id`,
          [`+38591${crypto.randomUUID().replaceAll('-', '').slice(0, 7)}`, email, userId],
        )
    const vehicle = await client.query<{ id: string }>(
      `insert into app.vehicles (
         registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on
       ) values ($1, 'fixed', '2030-01-01', '2030-01-01', '2030-01-01') returning id`,
      [plate],
    )
    const transfer = await client.query<{ id: string }>(
      `insert into app.transfers (
         client_id, pickup_at, start_location_id, end_location_id,
         passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count, external_id
       ) values ($1, $2, $3, $4, 1, 'Gost Sesija', 10.00, 'cash', false, 0, 0, gen_random_uuid()::text)
       returning id`,
      [clientRow.rows[0]?.id, pickup.toISOString(), start.rows[0]?.id, end.rows[0]?.id],
    )
    const ride = await client.query<{ id: string }>(
      `insert into app.rides (transfer_id, state) values ($1, 'unassigned') returning id`,
      [transfer.rows[0]?.id],
    )
    await client.query(
      `update app.rides
       set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = false
       where id = $1`,
      [ride.rows[0]?.id, driver.rows[0]?.id, vehicle.rows[0]?.id],
    )
    const id = ride.rows[0]?.id
    if (!id)
      throw new Error('ride was not inserted')
    return id
  })
}

async function markDone(tenantId: string, rideId: string): Promise<void> {
  await withTenant(tenantId, client => client.query(
    `update app.rides set state = 'done' where id = $1`,
    [rideId],
  ))
}

async function useDriverTenant(headers: Headers, driverTenantId: string): Promise<void> {
  const opened = await readSessionShell(headers).catch(error => error)
  if (opened instanceof TenantAccessError) {
    expect(opened.statusCode).toBe(409)
    await chooseActiveTenant(headers, driverTenantId)
    return
  }
  if (opened.tenantId === driverTenantId)
    return
  await switchActiveTenant(headers, driverTenantId)
}

it('refuses an office session twelve hours after sign-in and does not let a refresh restore seven days', async () => {
  const admin = await openTenant('office')
  const headers = await signIn(admin.email)
  expectHours(await sessionLife(admin.userId), 12)

  const refreshed = await auth.auth.handler(new Request(`${baseUrl}/api/auth/get-session`, { headers }))
  expect(refreshed.ok).toBe(true)
  expectHours(await sessionLife(admin.userId), 12)

  await authPool.query(
    `update auth.session set expires_at = now() + interval '7 days' where user_id = $1`,
    [admin.userId],
  )
  expectHours(await sessionLife(admin.userId), 12)

  const shell = await readSessionShell(headers)
  expect(shell.holdingRide).toBe(false)
  expect(Date.parse(shell.sessionEndsAt) - Date.parse(shell.signedInAt)).toBe(12 * 60 * 60 * 1000)

  await ageSession(admin.userId, '12 hours 1 minute')
  await expect(readSessionShell(headers)).rejects.toMatchObject({ statusCode: 401 })

  const dispatcher = await openMember(admin.tenantId, 'dispatcher', 'dispatch')
  const dispatcherHeaders = await signIn(dispatcher.email)
  expectHours(await sessionLife(dispatcher.userId), 12)
  await ageSession(dispatcher.userId, '12 hours 1 minute')
  await expect(readSessionShell(dispatcherHeaders)).rejects.toMatchObject({ statusCode: 401 })
})

it('refuses a driver at twelve hours unless a Ride in this Tenant is holding, and at sixteen hours anyway', async () => {
  const home = await openTenant('driver-home')
  const other = await openTenant('driver-other')
  const driver = await openMember(home.tenantId, 'driver', 'driver')
  await insertMembership(authPool, other.tenantId, driver.userId, 'driver')
  const headers = await signIn(driver.email)
  await useDriverTenant(headers, home.tenantId)
  expectHours(await sessionLife(driver.userId), 16)

  await ageSession(driver.userId, '13 hours')
  await expect(updateUserLocale(headers, 'en')).rejects.toMatchObject({ statusCode: 401 })
  await expect(readSessionShell(headers)).rejects.toMatchObject({ statusCode: 401 })

  const again = await signIn(driver.email)
  await useDriverTenant(again, home.tenantId)
  const pickup = pastPickupOnThisOperationalDay()
  const held = await seedAssignedRide(home.tenantId, driver.userId, driver.email, pickup)
  const elsewhere = await seedAssignedRide(other.tenantId, driver.userId, driver.email, pickup)
  await ageSession(driver.userId, '13 hours')

  const open = await readSessionShell(again)
  expect(open.holdingRide).toBe(true)
  expect(open.tenantId).toBe(home.tenantId)
  expect(Date.parse(open.sessionEndsAt) - Date.parse(open.signedInAt)).toBe(16 * 60 * 60 * 1000)

  await markDone(home.tenantId, held)
  // The Ride in the other Tenant is still in progress. It does not hold this session.
  await expect(readSessionShell(again)).rejects.toMatchObject({ statusCode: 401 })
  expect(elsewhere).toEqual(expect.any(String))

  const third = await signIn(driver.email)
  await useDriverTenant(third, home.tenantId)
  const first = await seedAssignedRide(home.tenantId, driver.userId, driver.email, pickup)
  const second = await seedAssignedRide(home.tenantId, driver.userId, driver.email, pickup)
  await ageSession(driver.userId, '13 hours')
  expect((await readSessionShell(third)).holdingRide).toBe(true)
  await markDone(home.tenantId, first)
  expect((await readSessionShell(third)).holdingRide).toBe(true)
  await markDone(home.tenantId, second)
  await expect(readSessionShell(third)).rejects.toMatchObject({ statusCode: 401 })

  const capped = await signIn(driver.email)
  await useDriverTenant(capped, home.tenantId)
  await seedAssignedRide(home.tenantId, driver.userId, driver.email, pickup)
  await ageSession(driver.userId, '16 hours 1 minute')
  await expect(readSessionShell(capped)).rejects.toMatchObject({ statusCode: 401 })
})

it('keeps a sole driver at sixteen hours when the row has no company, and two companies at twelve', async () => {
  const home = await openTenant('sole-driver')
  const driver = await openMember(home.tenantId, 'driver', 'sole')
  await signIn(driver.email)
  await authPool.query(
    `update auth.session set active_organization_id = null where user_id = $1`,
    [driver.userId],
  )
  expectHours(await sessionLife(driver.userId), 16)

  const other = await openTenant('two-driver')
  await insertMembership(authPool, other.tenantId, driver.userId, 'driver')
  await authPool.query(
    `update auth.session set active_organization_id = null where user_id = $1`,
    [driver.userId],
  )
  expectHours(await sessionLife(driver.userId), 12)
})

it('ends the session when an office membership is opened after twelve hours', async () => {
  const driving = await openTenant('switch-drive')
  const office = await openTenant('switch-office')
  const driver = await openMember(driving.tenantId, 'driver', 'switch')
  await insertMembership(authPool, office.tenantId, driver.userId, 'admin')
  const headers = await signIn(driver.email)
  await useDriverTenant(headers, driving.tenantId)
  await seedAssignedRide(driving.tenantId, driver.userId, driver.email, pastPickupOnThisOperationalDay())
  await ageSession(driver.userId, '13 hours')
  expect((await readSessionShell(headers)).holdingRide).toBe(true)

  await expect(switchActiveTenant(headers, office.tenantId)).rejects.toMatchObject({ statusCode: 401 })
  await expect(readSessionShell(headers)).rejects.toMatchObject({ statusCode: 401 })
})

async function removeTenant(slug: string): Promise<void> {
  const owner = await ownerPool.connect()
  try {
    const found = await owner.query<{ id: string }>(
      'select id from auth.organization where slug = $1',
      [slug],
    )
    const tenantId = found.rows[0]?.id
    if (!tenantId)
      return
    await owner.query('delete from app.mail_outbox where tenant_id = $1', [tenantId])
    await owner.query('delete from app.ride_alert where tenant_id = $1', [tenantId])
    await owner.query('delete from app.rides where tenant_id = $1', [tenantId])
    await owner.query('delete from app.transfers where tenant_id = $1', [tenantId])
    await owner.query('delete from app.drivers where tenant_id = $1', [tenantId])
    await owner.query('delete from app.vehicles where tenant_id = $1', [tenantId])
    await owner.query('delete from app.locations where tenant_id = $1', [tenantId])
    await owner.query('delete from app.clients where tenant_id = $1', [tenantId])
    await owner.query('delete from app.tenant_settings where tenant_id = $1', [tenantId])
  }
  finally {
    owner.release()
  }
  await authPool.query(
    `delete from auth.invitation where organization_id in (select id from auth.organization where slug = $1)`,
    [slug],
  )
  await authPool.query(
    `delete from auth.member where organization_id in (select id from auth.organization where slug = $1)`,
    [slug],
  )
  await authPool.query('delete from auth.organization where slug = $1', [slug])
}

async function removeUser(email: string): Promise<void> {
  await authPool.query(
    `delete from auth.session where user_id in (select id from auth."user" where lower(email) = $1)`,
    [email],
  )
  await authPool.query(
    `delete from auth.account where user_id in (select id from auth."user" where lower(email) = $1)`,
    [email],
  )
  await authPool.query(
    `delete from auth.member where user_id in (select id from auth."user" where lower(email) = $1)`,
    [email],
  )
  await authPool.query('delete from auth."user" where lower(email) = $1', [email])
}
