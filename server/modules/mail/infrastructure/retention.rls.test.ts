import type { JobQueue, QueuedJob, TenantTransaction } from '../../../core/index'
import { loadEnvFile } from 'node:process'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { openTenantSession } from '../../../core/index'
import { captureLogs } from '../../../core/testing'
import { listTenantsWithOutboxBefore, MAIL_RETENTION_DELETE, MAIL_RETENTION_TICK, registerMailOutboxRetention } from './retention'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * The 90-day delete on real rows (ADR-0045). The fixtures are invitation
 * entries, which need no Ride or Driver, under two fresh Tenant ids.
 * The clock is fixed, so 89, 90, and 91 days are exact.
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
const now = new Date('2026-10-19T03:15:00.000Z')
const day = 24 * 60 * 60 * 1000

afterAll(async () => {
  await ownerPool.query('delete from app.mail_outbox where tenant_id = any($1::uuid[])', [[tenantA, tenantB]])
  await ownerPool.end()
  await appPool.end()
})

async function seed(tenantId: string, label: string, state: string, ageDays: number): Promise<string> {
  const inserted = await ownerPool.query<{ id: string }>(
    `insert into app.mail_outbox (tenant_id, kind, invitation_id, state, attempt_count, created_at)
     values ($1, 'invitation', $2, $3, $4, $5)
     returning id`,
    [tenantId, crypto.randomUUID(), state, state === 'failed' ? 4 : 1, new Date(now.getTime() - ageDays * day)],
  )
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error(`fixture ${label} was not written`)
  return id
}

async function idsOf(tenantId: string): Promise<string[]> {
  const rows = await ownerPool.query<{ id: string }>(
    'select id from app.mail_outbox where tenant_id = $1 order by id',
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

it('grants DELETE on the outbox to the app role, and on no other new table', async () => {
  const grants = await ownerPool.query<{ grant: string }>(`
    select table_schema || '.' || table_name || ' ' || grantee as grant
    from information_schema.role_table_grants
    where privilege_type = 'DELETE'
      and table_schema in ('app', 'audit', 'platform')
      and grantee <> 'transferpro_owner'
    order by 1
  `)
  expect(grants.rows.map(row => row.grant)).toEqual([
    'app.client_contact_persons transferpro_app',
    'app.mail_outbox transferpro_app',
    'app.roster transferpro_app',
    'app.tenant_settings transferpro_app',
    'app.unavailability_windows transferpro_app',
  ])
  // Better Auth's tables are the auth role's alone (ADR-0011). No other role may delete there.
  const authGrants = await ownerPool.query<{ grant: string }>(`
    select table_name || ' ' || grantee as grant
    from information_schema.role_table_grants
    where privilege_type = 'DELETE'
      and table_schema = 'auth'
      and grantee not in ('transferpro_owner', 'transferpro_auth')
  `)
  expect(authGrants.rows).toEqual([])
  const truncate = await ownerPool.query<{ app: boolean, auth: boolean, queue: boolean, platform: boolean }>(`
    select has_table_privilege('transferpro_app', 'app.mail_outbox', 'TRUNCATE') as app,
           has_table_privilege('transferpro_auth', 'app.mail_outbox', 'DELETE') as auth,
           has_table_privilege('transferpro_queue', 'app.mail_outbox', 'DELETE') as queue,
           has_table_privilege('transferpro_platform', 'app.mail_outbox', 'DELETE') as platform
  `)
  expect(truncate.rows).toEqual([{ app: false, auth: false, queue: false, platform: false }])
  const listing = await ownerPool.query<{ app: boolean, auth: boolean, platform: boolean }>(`
    select has_function_privilege('transferpro_app', 'app.tenants_with_mail_outbox_before(timestamptz)', 'EXECUTE') as app,
           has_function_privilege('transferpro_auth', 'app.tenants_with_mail_outbox_before(timestamptz)', 'EXECUTE') as auth,
           has_function_privilege('transferpro_platform', 'app.tenants_with_mail_outbox_before(timestamptz)', 'EXECUTE') as platform
  `)
  expect(listing.rows).toEqual([{ app: true, auth: false, platform: false }])
})

it('deletes Tenant A entries older than 90 days in every state, keeps 89 and 90 days, and leaves Tenant B and every other table alone', async () => {
  const keptA = [
    await seed(tenantA, 'a-89', 'pending', 89),
    await seed(tenantA, 'a-90', 'sent', 90),
  ]
  for (const state of ['pending', 'sent', 'failed', 'stale'])
    await seed(tenantA, `a-91-${state}`, state, 91)
  const keptB = [
    await seed(tenantB, 'b-89', 'failed', 89),
    await seed(tenantB, 'b-91', 'failed', 91),
  ]
  const before = await tableCounts()

  const logs = captureLogs()
  const { queue, handlers } = capturingQueue()
  await registerMailOutboxRetention(queue, {
    log: logs.logger,
    now: () => now,
    listTenantIds: cutoff => listTenantsWithOutboxBefore(appPool, cutoff),
  })

  const published: Array<{ tenantId: string, name: string, data: unknown }> = []
  const tick = handlers.get(MAIL_RETENTION_TICK) as Parameters<JobQueue['workScheduled']>[1]
  await tick({ id: 'tick-1', name: MAIL_RETENTION_TICK, data: {} }, async (tenantId, name, data) => {
    published.push({ tenantId, name, data })
  })
  const ours = published.filter(job => job.tenantId === tenantA || job.tenantId === tenantB)
  expect(ours).toHaveLength(2)
  expect(ours).toEqual(expect.arrayContaining([
    { tenantId: tenantA, name: MAIL_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
    { tenantId: tenantB, name: MAIL_RETENTION_DELETE, data: { askedAt: now.toISOString() } },
  ]))

  // Only Tenant A's job runs. The worker opens the session from the job envelope the same way.
  const remove = handlers.get(MAIL_RETENTION_DELETE) as (job: QueuedJob, scope: { transaction: TenantTransaction }) => Promise<void>
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId: tenantA }, async () => {
      await remove(
        { id: 'job-a', name: MAIL_RETENTION_DELETE, tenantId: tenantA, data: { askedAt: now.toISOString() } },
        { transaction },
      )
    })
  })

  expect(await idsOf(tenantA)).toEqual([...keptA].sort())
  expect(await idsOf(tenantB)).toEqual([...keptB].sort())

  const after = await tableCounts()
  expect([...after.keys()]).toEqual([...before.keys()])
  for (const [table, count] of before) {
    const expected = table === 'app.mail_outbox' ? count - 4 : count
    expect({ table, count: after.get(table) }).toEqual({ table, count: expected })
  }

  const lines = logs.lines()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ event: 'mail_outbox.retention_deleted', deleted: 4, tenant_id: tenantA })
})

it('lets the app role delete only its own Tenant entries', async () => {
  const old = await seed(tenantB, 'b-iso', 'sent', 120)
  const client = await appPool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantA])
    const deleted = await client.query('delete from app.mail_outbox where tenant_id = $1', [tenantB])
    await client.query('commit')
    expect(deleted.rowCount).toBe(0)
  }
  finally {
    client.release()
  }
  expect(await idsOf(tenantB)).toContain(old)
})
