import type { TenantRole } from '../../../shared'
import type { JobQueue, QueuedJob } from '../../core/index'
import { Buffer } from 'node:buffer'
import { loadEnvFile } from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { createApp, toWebHandler } from 'h3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { instantFromWallClock, operationalDateInTimeZone } from '../../../shared'
import { configureLogger } from '../../core/index'
import { createClient, writeClientBilling } from '../../modules/clients'
import { createDriver } from '../../modules/drivers'
import { handleInvoiceCreateJob, selectInvoicingMode, writeInvoicingSettings } from '../../modules/invoicing'
import { createLocation } from '../../modules/locations'
import { closeTenantRuntime, createTenant, handleAuthRequest, withTenantFromSession } from '../../modules/tenancy'
import { assignRide, correctTransfer, createTransfer, markRideDone } from '../../modules/transfers'
import { createVehicle } from '../../modules/vehicles'
import postInvoice from './[id]/invoice.post'

/**
 * POST /api/transfers/:id/invoice. A driver is 403. A price of 0 writes
 * nothing. Another Tenant cannot read the row. A locking invoice refuses
 * a price change. The app role cannot delete an invoice (ADR-0051, ADR-0053).
 */
loadEnvFile('.env')
loadEnvFile('.env.migrate')

if (process.env.INVOICING_SECRET_KEY === undefined || process.env.INVOICING_SECRET_KEY === '')
  process.env.INVOICING_SECRET_KEY = Buffer.alloc(32, 9).toString('base64')

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const authDatabaseUrl = required('AUTH_DATABASE_URL')
const migrateDatabaseUrl = required('DATABASE_MIGRATE_URL')
const databaseUrl = required('DATABASE_URL')
const password = 'invoice-http-password'
const authPool = new pg.Pool({ connectionString: authDatabaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateDatabaseUrl })
const appPool = new pg.Pool({ connectionString: databaseUrl })
const authUrl = required('BETTER_AUTH_URL')

const issue = toWebHandler(createApp().use((event) => {
  event.context.params = { id: event.path.replace(/^\//, '') }
  return postInvoice(event)
}))

const licence = '2031-01-01'

beforeAll(async () => {
  configureLogger('info')
  selectInvoicingMode('fake')
  const owner = await ownerPool.connect()
  const auth = await authPool.connect()
  try {
    await owner.query('begin')
    const tenants = `select id from auth.organization where slug like 'inv439-%'`
    await owner.query(`delete from app.invoices where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.invoicing_create_gate where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.invoicing_settings where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.client_billing_details where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.mail_outbox where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.rides where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.transfers where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.drivers where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.vehicles where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.locations where tenant_id::text in (${tenants})`)
    await owner.query(`delete from app.clients where tenant_id::text in (${tenants})`)
    await owner.query('commit')
    await auth.query('begin')
    await auth.query(`delete from auth.session where user_id in (select id from auth."user" where email like 'inv439-%@example.test')`)
    await auth.query(`delete from auth.member where user_id in (select id from auth."user" where email like 'inv439-%@example.test')`)
    await auth.query(`delete from auth."user" where email like 'inv439-%@example.test'`)
    await auth.query(`delete from auth.organization where slug like 'inv439-%'`)
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
  selectInvoicingMode('none')
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
    adminName: 'Iva Admin',
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

async function postIssue(headers: Headers | undefined, transferId: string): Promise<Response> {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('content-type', 'application/json')
  return issue(new Request(`http://localhost/${transferId}`, {
    method: 'POST',
    headers: requestHeaders,
    body: '{}',
  }))
}

async function invoiceCount(tenantId: string): Promise<number> {
  const counted = await ownerPool.query<{ n: number }>(
    'select count(*)::int as n from app.invoices where tenant_id = $1',
    [tenantId],
  )
  return counted.rows[0]?.n ?? 0
}

async function invoiceAuditCount(tenantId: string): Promise<number> {
  const counted = await ownerPool.query<{ n: number }>(
    `select count(*)::int as n from app.audit_entry
     where tenant_id = $1 and action::text like 'invoice.%'`,
    [tenantId],
  )
  return counted.rows[0]?.n ?? 0
}

async function jobCount(invoiceId: string): Promise<number> {
  const counted = await ownerPool.query<{ n: number }>(
    `select count(*)::int as n from pgboss.job where data #>> '{data,invoiceId}' = $1`,
    [invoiceId],
  )
  return counted.rows[0]?.n ?? 0
}

const queue = {
  enqueue: async () => {},
  handleNext: async () => null,
  schedule: async () => {},
  workScheduled: async () => {},
  work: async () => {},
  close: async () => {},
} as JobQueue

async function seedOffice(slug: string) {
  const created = await tenant(slug)
  await addMember(created.tenantId, `${slug}-driver@example.test`, 'Drago Driver', 'driver')
  const admin = await signIn(`${slug}-admin@example.test`)
  const driver = await signIn(`${slug}-driver@example.test`)
  const client = await createClient(admin, { name: 'Agencija Račun', kind: 'agency' })
  const start = await createLocation(admin, { name: 'Zračna luka', kind: 'airport' })
  const end = await createLocation(admin, { name: 'Hotel Park', kind: 'hotel' })
  const driverRow = await createDriver(admin, {
    name: 'Ivo Račun',
    kind: 'own',
    phone: slug.endsWith('refuse') ? '+385914390011' : '+385914390012',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const vehicle = await createVehicle(admin, {
    registrationPlate: slug.endsWith('refuse') ? 'DU439RF' : 'DU439IS',
    kind: 'fixed',
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  return { created, admin, driver, client, start, end, driverRow, vehicle }
}

function pickup(): string {
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  return instantFromWallClock(`${day}T15:00`, 'Europe/Zagreb').toISOString()
}

async function bookAndFinish(
  admin: Headers,
  seed: Awaited<ReturnType<typeof seedOffice>>,
  price: number,
) {
  const recorded = await createTransfer(admin, {
    externalId: crypto.randomUUID(),
    clientId: seed.client.id,
    pickupAt: pickup(),
    startLocationId: seed.start.id,
    endLocationId: seed.end.id,
    passengerCount: 4,
    guestName: 'Iva Račun',
    price,
    payment: 'invoice_to_agency',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    clientReference: 'V-19',
  })
  await assignRide(admin, {
    rideId: recorded.ride.id,
    driverId: seed.driverRow.id,
    vehicleId: seed.vehicle.id,
    version: 0,
  })
  await markRideDone(admin, recorded.ride.id, {})
  return recorded
}

it('refuses a price of 0 and a driver, and writes no invoice, audit, or job', async () => {
  const seed = await seedOffice('inv439-refuse')
  const recorded = await bookAndFinish(seed.admin, seed, 0)
  const beforeJobs = await ownerPool.query<{ n: number }>('select count(*)::int as n from pgboss.job where name = $1', ['invoice-create'])

  const refused = await postIssue(seed.admin, recorded.transfer.id)
  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({ data: { code: 'not_invoiceable' } })
  expect(await invoiceCount(seed.created.tenantId)).toBe(0)
  expect(await invoiceAuditCount(seed.created.tenantId)).toBe(0)

  const forbidden = await postIssue(seed.driver, recorded.transfer.id)
  expect(forbidden.status).toBe(403)
  expect(await invoiceCount(seed.created.tenantId)).toBe(0)
  expect(await invoiceAuditCount(seed.created.tenantId)).toBe(0)
  const afterJobs = await ownerPool.query<{ n: number }>('select count(*)::int as n from pgboss.job where name = $1', ['invoice-create'])
  expect(afterJobs.rows[0]?.n).toBe(beforeJobs.rows[0]?.n)
})

it('issues once, keeps the row inside the Tenant, and locks the price', async () => {
  const seed = await seedOffice('inv439-issue')
  const other = await tenant('inv439-other')
  const otherAdmin = await signIn('inv439-other-admin@example.test')
  const recorded = await bookAndFinish(seed.admin, seed, 80)
  const missingBilling = await postIssue(seed.admin, recorded.transfer.id)
  expect(missingBilling.status).toBe(409)
  expect(await missingBilling.json()).toMatchObject({ data: { code: 'billing_details_missing' } })
  expect(await invoiceCount(seed.created.tenantId)).toBe(0)
  expect(await invoiceAuditCount(seed.created.tenantId)).toBe(0)

  await writeClientBilling(seed.admin, seed.client.id, {
    legalName: 'Agencija Račun d.o.o.',
    country: 'HR',
    oib: '12345678903',
    vatId: null,
    address: 'Obala 1, Split',
    guestNameOnInvoice: false,
  })
  const notReady = await postIssue(seed.admin, recorded.transfer.id)
  expect(notReady.status).toBe(409)
  expect(await notReady.json()).toMatchObject({ data: { code: 'invoicing_not_ready' } })
  expect(await invoiceCount(seed.created.tenantId)).toBe(0)

  await writeInvoicingSettings(seed.admin, {
    dueDays: 15,
    vatRate: 25,
    lineText: 'Transfer',
    version: 0,
    token: 'route-invoice-token',
  })

  const issued = await postIssue(seed.admin, recorded.transfer.id)
  expect(issued.status).toBe(200)
  const invoice = await issued.json() as { id: string, state: string, number: string | null }
  expect(invoice).toMatchObject({ state: 'requested', number: null })
  expect(await jobCount(invoice.id)).toBe(1)
  const again = await postIssue(seed.admin, recorded.transfer.id)
  expect(again.status).toBe(200)
  expect(await again.json()).toMatchObject({ id: invoice.id, state: 'requested' })
  expect(await invoiceCount(seed.created.tenantId)).toBe(1)
  expect(await jobCount(invoice.id)).toBe(1)

  const hidden = await postIssue(otherAdmin, recorded.transfer.id)
  expect(hidden.status).toBe(404)
  const seenByOther = await appPool.connect()
  try {
    await seenByOther.query('begin')
    await seenByOther.query(`select set_config('app.tenant_id', $1, true)`, [other.tenantId])
    const rows = await seenByOther.query('select id from app.invoices')
    expect(rows.rows).toEqual([])
    await seenByOther.query('rollback')
  }
  finally {
    seenByOther.release()
  }

  await withTenantFromSession(seed.admin, async ({ transaction }) => {
    const job: QueuedJob = {
      id: crypto.randomUUID(),
      name: 'invoice-create',
      tenantId: seed.created.tenantId,
      data: { invoiceId: invoice.id },
    }
    await handleInvoiceCreateJob(job, transaction, queue)
  })
  const stored = await ownerPool.query<{ state: string, invoice_number: string, line_text: string }>(
    'select state, invoice_number, line_text from app.invoices where id = $1',
    [invoice.id],
  )
  expect(stored.rows[0]?.state).toBe('created')
  expect(stored.rows[0]?.invoice_number).toMatch(/^F-\d+$/)
  expect(stored.rows[0]?.line_text).toContain('4 putnika')
  expect(stored.rows[0]?.line_text).not.toContain('Iva Račun')

  const version = await ownerPool.query<{ version: number }>(
    'select version from app.transfers where id = $1',
    [recorded.transfer.id],
  )
  await expect(correctTransfer(seed.admin, recorded.transfer.id, {
    clientId: seed.client.id,
    pickupAt: pickup(),
    startLocationId: seed.start.id,
    endLocationId: seed.end.id,
    passengerCount: 4,
    guestName: 'Iva Račun',
    price: 90,
    payment: 'invoice_to_agency',
    airportMark: false,
    luggageCount: 0,
    childSeatCount: 0,
    clientReference: 'V-19',
    version: version.rows[0]?.version,
  })).rejects.toMatchObject({ code: 'transfer_invoiced' })
  const unchanged = await ownerPool.query<{ version: number, price: string }>(
    'select version, price from app.transfers where id = $1',
    [recorded.transfer.id],
  )
  expect(unchanged.rows[0]?.version).toBe(version.rows[0]?.version)
  expect(unchanged.rows[0]?.price).toBe('80.00')

  const deleter = await appPool.connect()
  try {
    await deleter.query('begin')
    await deleter.query(`select set_config('app.tenant_id', $1, true)`, [seed.created.tenantId])
    await expect(deleter.query('delete from app.invoices')).rejects.toMatchObject({ code: '42501' })
    await deleter.query('rollback')
  }
  finally {
    deleter.release()
  }
})
