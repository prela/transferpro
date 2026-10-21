import type { JobQueue, QueuedJob, TenantTransaction } from '../../../core/index'
import { loadEnvFile } from 'node:process'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { openTenantSession } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { CONTACT_PERSON_RETENTION_DELETE, CONTACT_PERSON_RETENTION_TICK, listTenantsWithContactPersonsRemovedBefore, registerContactPersonRetention } from './retention'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The 90-day delete of removed contact persons on real rows (ADR-0049,
 * issue #365). The row policy compares against the database clock, so the
 * fixtures are aged from the real `now` and 89 and 91 days stay one day
 * clear of the edge. Clients are written by the owner under two fresh
 * Tenant ids, because the contact person's composite key needs them.
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
  for (const table of ['client_contact_persons', 'clients'])
    await ownerPool.query(`delete from app.${table} where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]])
  await ownerPool.end()
  await appPool.end()
})

const written = new Map<string, Promise<string>>()

/** One Client per Tenant, written once. */
function clientOf(tenantId: string): Promise<string> {
  const known = written.get(tenantId) ?? writeClient(tenantId)
  written.set(tenantId, known)
  return known
}

async function writeClient(tenantId: string): Promise<string> {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.clients (tenant_id, name, kind) values ($1, 'Hotel Jadran', 'hotel') returning id`,
    [tenantId],
  )
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('fixture client was not written')
  return id
}

/**
 * One contact person. `ageDays` null is a live person. A number is how many
 * days ago the person was removed.
 */
async function seed(tenantId: string, ageDays: number | null): Promise<string> {
  const removedAt = ageDays === null ? null : new Date(now.getTime() - ageDays * day)
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.client_contact_persons (tenant_id, client_id, name, phone, removed_at)
     values ($1, $2, 'Ana Booking', '+385911110364', $3) returning id`,
    [tenantId, await clientOf(tenantId), removedAt],
  )
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('fixture contact person was not written')
  return id
}

async function idsOf(tenantId: string): Promise<string[]> {
  const rows = await ownerPool.query<{ id: string }>(
    'select id from app.client_contact_persons where tenant_id = $1 order by id',
    [tenantId],
  )
  return rows.rows.map(row => row.id)
}

/** Every table outside the queue, counted by the owner role, which sees past the row policy. */
async function tableCounts(): Promise<Map<string, number>> {
  const tables = await ownerPool.query<{ name: string }>(`
    select quote_ident(table_schema) || '.' || quote_ident(table_name) as name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('app', 'audit', 'auth', 'platform')
    order by 1
  `)
  const counts = new Map<string, number>()
  for (const { name } of tables.rows) {
    const counted = await ownerPool.query<{ n: string }>(`select count(*) as n from ${name}`)
    counts.set(name, Number(counted.rows[0]?.n))
  }
  return counts
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

it('grants DELETE on contact persons to the app role alone, no TRUNCATE, and the Tenant listing to the app role alone', async () => {
  const grants = await ownerPool.query<{ grantee: string }>(`
    select grantee from information_schema.role_table_grants
    where privilege_type = 'DELETE'
      and table_schema = 'app' and table_name = 'client_contact_persons'
      and grantee <> 'transferpro_owner'
    order by 1
  `)
  expect(grants.rows.map(row => row.grantee)).toEqual(['transferpro_app'])
  const others = await ownerPool.query<{ truncate: boolean, auth: boolean, queue: boolean, platform: boolean, public: boolean }>(`
    select has_table_privilege('transferpro_app', 'app.client_contact_persons', 'TRUNCATE') as truncate,
           has_table_privilege('transferpro_auth', 'app.client_contact_persons', 'DELETE') as auth,
           has_table_privilege('transferpro_queue', 'app.client_contact_persons', 'DELETE') as queue,
           has_table_privilege('transferpro_platform', 'app.client_contact_persons', 'DELETE') as platform,
           exists (
             select 1 from information_schema.role_table_grants
             where table_schema = 'app' and table_name = 'client_contact_persons' and grantee = 'PUBLIC'
           ) as public
  `)
  expect(others.rows).toEqual([{ truncate: false, auth: false, queue: false, platform: false, public: false }])
  const listing = await ownerPool.query<{ app: boolean, auth: boolean, platform: boolean }>(`
    select has_function_privilege('transferpro_app', 'app.tenants_with_contact_persons_removed_before(timestamptz)', 'EXECUTE') as app,
           has_function_privilege('transferpro_auth', 'app.tenants_with_contact_persons_removed_before(timestamptz)', 'EXECUTE') as auth,
           has_function_privilege('transferpro_platform', 'app.tenants_with_contact_persons_removed_before(timestamptz)', 'EXECUTE') as platform
  `)
  expect(listing.rows).toEqual([{ app: true, auth: false, platform: false }])
  const table = await ownerPool.query<{ forced: boolean }>(`
    select relforcerowsecurity as forced from pg_class where oid = 'app.client_contact_persons'::regclass
  `)
  expect(table.rows).toEqual([{ forced: true }])
})

it('deletes Tenant A persons removed 91 days ago, keeps a live person and one removed 89 days ago, and leaves Tenant B and every other table alone', async () => {
  const keptA = [
    await seed(tenantA, null),
    await seed(tenantA, 89),
    await seed(tenantA, 0),
  ]
  await seed(tenantA, 91)
  await seed(tenantA, 120)
  const keptB = [
    await seed(tenantB, null),
    await seed(tenantB, 91),
  ]
  const before = await tableCounts()

  const logs = captureLogs()
  const { queue, handlers } = capturingQueue()
  await registerContactPersonRetention(queue, {
    log: logs.logger,
    now: () => now,
    listTenantIds: cutoff => listTenantsWithContactPersonsRemovedBefore(appPool, cutoff),
  })

  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  const tick = handlers.get(CONTACT_PERSON_RETENTION_TICK) as Parameters<JobQueue['workScheduled']>[1]
  await tick({ id: 'tick-1', name: CONTACT_PERSON_RETENTION_TICK, data: {} }, async (tenantId, name, data) => {
    published.push({ tenantId, name, data })
  })
  const ours = published.filter(job => job.tenantId === tenantA || job.tenantId === tenantB)
  expect(ours).toHaveLength(2)
  expect(ours).toEqual(expect.arrayContaining([
    { tenantId: tenantA, name: CONTACT_PERSON_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
    { tenantId: tenantB, name: CONTACT_PERSON_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
  ]))

  // Only Tenant A's job runs, on the Tenant session the worker opens from the envelope.
  const remove = handlers.get(CONTACT_PERSON_RETENTION_DELETE) as (job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: tenantA }, async () => {
      await remove(
        { id: 'job-a', name: CONTACT_PERSON_RETENTION_DELETE, tenantId: tenantA, data: { askedAt: now.toISOString() } },
        { transaction },
      )
    })
  })

  expect(await idsOf(tenantA)).toEqual([...keptA].sort())
  expect(await idsOf(tenantB)).toEqual([...keptB].sort())

  const after = await tableCounts()
  expect([...after.keys()]).toEqual([...before.keys()])
  for (const [table, count] of before) {
    const expected = table === 'app.client_contact_persons' ? count - 2 : count
    expect({ table, count: after.get(table) }).toEqual({ table, count: expected })
  }

  const lines = logs.lines()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ event: 'contact_person.retention_deleted', deleted: 2, tenant_id: tenantA })
  const logged = JSON.stringify(lines)
  expect(logged).not.toContain('Ana Booking')
  expect(logged).not.toContain('+385911110364')
})

it('lets the app role delete neither a live person, nor one removed within 90 days, nor an old one of another Tenant', async () => {
  const live = await seed(tenantA, null)
  const recent = await seed(tenantA, 10)
  const old = await seed(tenantB, 200)
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantA])
    expect((await client.query('delete from app.client_contact_persons where id = any($1::uuid[])', [[live, recent, old]])).rowCount).toBe(0)
    await client.query('commit')
  }
  finally {
    client.release()
  }
  expect(await idsOf(tenantA)).toEqual(expect.arrayContaining([live, recent]))
  expect(await idsOf(tenantB)).toContain(old)
})
