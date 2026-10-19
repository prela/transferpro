import type { JobQueue, QueuedJob, TenantTransaction } from '../../../core/index'
import { loadEnvFile } from 'node:process'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { openTenantSession } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { listTenantsWithWindowsEndedBefore, registerUnavailabilityRetention, UNAVAILABILITY_RETENTION_DELETE, UNAVAILABILITY_RETENTION_TICK } from './retention'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The 90-day delete of unavailability windows on real rows (ADR-0034,
 * issue #355). The row policy compares against the database clock, so the
 * fixtures are aged from the real `now` and 89 and 91 days stay one day
 * clear of the edge. Drivers and Vehicles are written by the owner under two
 * fresh Tenant ids, because the window's composite keys need them.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required`)
  return value
}

const ownerPool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL') })
const appPool = new pg.Pool({ connectionString: required('DATABASE_URL') })
const appDb = drizzle(appPool)

const tenantA = crypto.randomUUID()
const tenantB = crypto.randomUUID()
const now = new Date()
const day = 24 * 60 * 60 * 1000

afterAll(async () => {
  for (const table of ['unavailability_windows', 'drivers', 'vehicles'])
    await ownerPool.query(`delete from app.${table} where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]])
  await ownerPool.end()
  await appPool.end()
})

const written = new Map<string, Promise<{ driverId: string, vehicleId: string }>>()

/** One Driver and one Vehicle per Tenant, written once. */
function resources(tenantId: string): Promise<{ driverId: string, vehicleId: string }> {
  const known = written.get(tenantId) ?? writeResources(tenantId)
  written.set(tenantId, known)
  return known
}

async function writeResources(tenantId: string): Promise<{ driverId: string, vehicleId: string }> {
  const driver = await ownerPool.query<{ id: string }>(
    `insert into app.drivers (tenant_id, name, kind, phone, driving_licence_expires_on, transport_licence_expires_on)
     values ($1, 'Marko Vozač', 'own', '+385910000000', '2030-01-01', '2030-01-01') returning id`,
    [tenantId],
  )
  const vehicle = await ownerPool.query<{ id: string }>(
    `insert into app.vehicles (tenant_id, registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on)
     values ($1, 'DU0001RT', 'fixed', '2030-01-01', '2030-01-01', '2030-01-01') returning id`,
    [tenantId],
  )
  const driverId = driver.rows[0]?.id
  const vehicleId = vehicle.rows[0]?.id
  if (driverId === undefined || vehicleId === undefined)
    throw new Error('fixture resources were not written')
  return { driverId, vehicleId }
}

/** A two-hour window that ended `ageDays` before now. */
async function seed(tenantId: string, owner: { driverId?: string, vehicleId?: string }, ageDays: number, removed = false): Promise<string> {
  const endsAt = new Date(now.getTime() - ageDays * day)
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.unavailability_windows (tenant_id, driver_id, vehicle_id, starts_at, ends_at, removed)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [tenantId, owner.driverId ?? null, owner.vehicleId ?? null, new Date(endsAt.getTime() - 2 * 60 * 60 * 1000), endsAt, removed],
  )
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('fixture window was not written')
  return id
}

async function idsOf(tenantId: string): Promise<string[]> {
  const rows = await ownerPool.query<{ id: string }>(
    'select id from app.unavailability_windows where tenant_id = $1 order by id',
    [tenantId],
  )
  return rows.rows.map(row => row.id)
}

function capturingQueue() {
  const handlers = new Map<string, unknown>()
  const queue: JobQueue = {
    async enqueue() {},
    async handleNext() {
      return null
    },
    async schedule() {},
    async workScheduled(name, handle) {
      handlers.set(name, handle)
    },
    async work(name, handle) {
      handlers.set(name, handle)
    },
    async close() {},
  }
  return { queue, handlers }
}

it('grants DELETE on windows to the app role alone, no TRUNCATE, and the Tenant listing to the app role alone', async () => {
  const grants = await ownerPool.query<{ grantee: string }>(`
    select grantee from information_schema.role_table_grants
    where privilege_type = 'DELETE'
      and table_schema = 'app' and table_name = 'unavailability_windows'
      and grantee <> 'transferpro_owner'
    order by 1
  `)
  expect(grants.rows.map(row => row.grantee)).toEqual(['transferpro_app'])
  const others = await ownerPool.query<{ truncate: boolean, auth: boolean, queue: boolean, platform: boolean, public: boolean }>(`
    select has_table_privilege('transferpro_app', 'app.unavailability_windows', 'TRUNCATE') as truncate,
           has_table_privilege('transferpro_auth', 'app.unavailability_windows', 'DELETE') as auth,
           has_table_privilege('transferpro_queue', 'app.unavailability_windows', 'DELETE') as queue,
           has_table_privilege('transferpro_platform', 'app.unavailability_windows', 'DELETE') as platform,
           exists (
             select 1 from information_schema.role_table_grants
             where table_schema = 'app' and table_name = 'unavailability_windows' and grantee = 'PUBLIC'
           ) as public
  `)
  expect(others.rows).toEqual([{ truncate: false, auth: false, queue: false, platform: false, public: false }])
  const listing = await ownerPool.query<{ app: boolean, auth: boolean, platform: boolean }>(`
    select has_function_privilege('transferpro_app', 'app.tenants_with_unavailability_ended_before(timestamptz)', 'EXECUTE') as app,
           has_function_privilege('transferpro_auth', 'app.tenants_with_unavailability_ended_before(timestamptz)', 'EXECUTE') as auth,
           has_function_privilege('transferpro_platform', 'app.tenants_with_unavailability_ended_before(timestamptz)', 'EXECUTE') as platform
  `)
  expect(listing.rows).toEqual([{ app: true, auth: false, platform: false }])
  const table = await ownerPool.query<{ forced: boolean }>(`
    select relforcerowsecurity as forced from pg_class where oid = 'app.unavailability_windows'::regclass
  `)
  expect(table.rows).toEqual([{ forced: true }])
})

it('deletes Tenant A windows that ended 91 days ago, removed or not, keeps 89 days, and leaves Tenant B alone', async () => {
  const a = await resources(tenantA)
  const b = await resources(tenantB)
  const keptA = [
    await seed(tenantA, { driverId: a.driverId }, 89),
    await seed(tenantA, { vehicleId: a.vehicleId }, 89, true),
    await seed(tenantA, { driverId: a.driverId }, -3),
  ]
  await seed(tenantA, { driverId: a.driverId }, 91)
  await seed(tenantA, { driverId: a.driverId }, 91, true)
  await seed(tenantA, { vehicleId: a.vehicleId }, 120)
  const keptB = [
    await seed(tenantB, { driverId: b.driverId }, 89),
    await seed(tenantB, { vehicleId: b.vehicleId }, 91),
  ]

  const logs = captureLogs()
  const { queue, handlers } = capturingQueue()
  await registerUnavailabilityRetention(queue, {
    log: logs.logger,
    now: () => now,
    listTenantIds: cutoff => listTenantsWithWindowsEndedBefore(appPool, cutoff),
  })

  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  const tick = handlers.get(UNAVAILABILITY_RETENTION_TICK) as Parameters<JobQueue['workScheduled']>[1]
  await tick({ id: 'tick-1', name: UNAVAILABILITY_RETENTION_TICK, data: {} }, async (tenantId, name, data) => {
    published.push({ tenantId, name, data })
  })
  const ours = published.filter(job => job.tenantId === tenantA || job.tenantId === tenantB)
  expect(ours).toHaveLength(2)
  expect(ours).toEqual(expect.arrayContaining([
    { tenantId: tenantA, name: UNAVAILABILITY_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
    { tenantId: tenantB, name: UNAVAILABILITY_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
  ]))

  // Only Tenant A's job runs, on the Tenant session the worker opens from the envelope.
  const remove = handlers.get(UNAVAILABILITY_RETENTION_DELETE) as (job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: tenantA }, async () => {
      await remove(
        { id: 'job-a', name: UNAVAILABILITY_RETENTION_DELETE, tenantId: tenantA, data: { askedAt: now.toISOString() } },
        { transaction },
      )
    })
  })

  expect(await idsOf(tenantA)).toEqual([...keptA].sort())
  expect(await idsOf(tenantB)).toEqual([...keptB].sort())
  const lines = logs.lines()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ event: 'unavailability.retention_deleted', deleted: 3, tenant_id: tenantA })
  expect(JSON.stringify(lines)).not.toContain(a.driverId)
})

it('lets the app role delete neither a recent window of its own Tenant nor an old one of another', async () => {
  const recent = await seed(tenantA, { driverId: (await resources(tenantA)).driverId }, 10)
  const old = await seed(tenantB, { driverId: (await resources(tenantB)).driverId }, 200)
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantA])
    expect((await client.query('delete from app.unavailability_windows where id = any($1::uuid[])', [[recent, old]])).rowCount).toBe(0)
    await client.query('commit')
  }
  finally {
    client.release()
  }
  expect(await idsOf(tenantA)).toContain(recent)
  expect(await idsOf(tenantB)).toContain(old)
})
