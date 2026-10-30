import type { TenantRole } from '../../shared'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { instantFromWallClock, officeHomeSchema, officeHomeUrgentRideCount } from '../../shared'
import { createClient } from '../modules/clients'
import { createLocation } from '../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest } from '../modules/tenancy'
import getOfficeHome from './office-home.get'

/**
 * GET /api/office-home. An unsent invoice is a Warning for this Tenant
 * only. A driver is 403. The reminder follows the Tenant's calendar.
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
const password = 'office-invoice-http-password'
const zone = 'Europe/Zagreb'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const app = createApp()
app.use('/api/office-home', getOfficeHome)
const callHome = toWebHandler(app)

beforeAll(async () => {
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    await owner.query(`delete from app.invoices where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query(`delete from app.rides where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query(`delete from app.transfers where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query(`delete from app.locations where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query(`delete from app.clients where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query(`delete from app.tenant_settings where tenant_id::text in (
      select id from auth.organization where slug like 'ihs-%'
    )`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'ihs-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'ihs-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'ihs-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'ihs-%'`)
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

function call(session: Headers | undefined, now: string) {
  const headers = new Headers(session)
  headers.set('x-office-now', now)
  return callHome(new Request('http://localhost/api/office-home', { method: 'GET', headers }))
}

async function seedDoneRide(tenantId: string, clientId: string, startId: string, endId: string, guestName: string): Promise<string> {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.transfers (
      tenant_id, client_id, pickup_at, start_location_id, end_location_id,
      passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count,
      external_id
    ) values ($1, $2, $3, $4, $5, 1, $6, '80.00', 'invoice_to_agency', false, 0, 0, gen_random_uuid()::text)
    returning id`,
    [tenantId, clientId, instantFromWallClock('2026-06-01T12:00', zone).toISOString(), startId, endId, guestName],
  )
  const transferId = inserted.rows[0]?.id
  if (transferId === undefined)
    throw new Error('transfer insert returned no row')
  await ownerPool.query(
    `insert into app.rides (tenant_id, transfer_id, state) values ($1, $2, 'done')`,
    [tenantId, transferId],
  )
  return transferId
}

async function seedInvoice(
  tenantId: string,
  transferId: string,
  clientId: string,
  state: 'created' | 'failed' | 'sent',
  language: 'hr' | 'en',
): Promise<void> {
  await ownerPool.query(
    `insert into app.invoices (
      tenant_id, transfer_reference, state, client_id, line_text, language,
      due_days, vat_rate, gross_amount, reason, asked_by
    ) values ($1, $2, $3, $4, 'Transfer', $5, 15, 25, '80.00', $6, 'office')`,
    [tenantId, transferId, state, clientId, language, state === 'failed' ? 'unavailable' : null],
  )
}

it('hides another Tenant unsent invoice, refuses a driver, and reminds only with a sent Croatian invoice', async () => {
  const created = await tenant('ihs-home', 'Hana Admin')
  await addMember(created.tenantId, 'ihs-home-driver@example.test', 'Drago Driver', 'driver')
  const other = await tenant('ihs-other', 'Iva Admin')
  const admin = await signIn('ihs-home-admin@example.test')
  const driver = await signIn('ihs-home-driver@example.test')
  const outsider = await signIn('ihs-other-admin@example.test')
  const client = await createClient(admin, { name: 'Agencija Mora', kind: 'agency' })
  const foreignClient = await createClient(outsider, { name: 'Agencija Tuđa', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Park', kind: 'hotel' })
  const foreignStart = await createLocation(outsider, { name: 'Tuđa luka', kind: 'airport' })
  const foreignEnd = await createLocation(outsider, { name: 'Tuđi hotel', kind: 'hotel' })

  const localGuest = 'Naš neposlani'
  const foreignGuest = 'Tuđi neposlani'
  const localTransfer = await seedDoneRide(created.tenantId, client.id, start.id, end.id, localGuest)
  const foreignTransfer = await seedDoneRide(other.tenantId, foreignClient.id, foreignStart.id, foreignEnd.id, foreignGuest)
  await seedInvoice(created.tenantId, localTransfer, client.id, 'created', 'hr')
  await seedInvoice(other.tenantId, foreignTransfer, foreignClient.id, 'created', 'hr')

  const midMonth = instantFromWallClock('2026-10-15T12:00', zone).toISOString()
  const refused = await call(driver, midMonth)
  expect(refused.status).toBe(403)
  expect(await refused.text()).not.toContain(localGuest)

  const home = officeHomeSchema.parse(await (await call(admin, midMonth)).json())
  expect(home.invoiceWarnings.map(row => [row.guestName, row.kind])).toEqual([[localGuest, 'unsent']])
  expect(officeHomeUrgentRideCount(home)).toBe(0)
  expect(home.paymentReportingReminder).toBe(false)
  const hidden = JSON.stringify(await (await call(outsider, midMonth)).json())
  expect(hidden).not.toContain(localGuest)
  expect(officeHomeSchema.parse(JSON.parse(hidden)).invoiceWarnings).toEqual([
    expect.objectContaining({ guestName: foreignGuest, kind: 'unsent' }),
  ])

  const sentTransfer = await seedDoneRide(created.tenantId, client.id, start.id, end.id, 'Poslani gost')
  await seedInvoice(created.tenantId, sentTransfer, client.id, 'sent', 'en')
  const englishOnly = officeHomeSchema.parse(await (await call(admin, midMonth)).json())
  expect(englishOnly.paymentReportingReminder).toBe(false)

  const domesticTransfer = await seedDoneRide(created.tenantId, client.id, start.id, end.id, 'Domaći poslani')
  await seedInvoice(created.tenantId, domesticTransfer, client.id, 'sent', 'hr')
  const edges: Array<[string, boolean]> = [
    ['2026-10-14T23:59', false],
    ['2026-10-15T00:00', true],
    ['2026-10-20T23:59', true],
    ['2026-10-21T00:00', false],
  ]
  for (const [wall, due] of edges) {
    const body = officeHomeSchema.parse(await (await call(admin, instantFromWallClock(wall, zone).toISOString())).json())
    expect(body.paymentReportingReminder).toBe(due)
  }
  expect(JSON.stringify(home)).not.toContain(foreignGuest)
})
