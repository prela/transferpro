import type { JobQueue, TenantTransaction } from './index'
import { loadEnvFile } from 'node:process'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { openTenantSession, parseAppEnv, runWithRequestId } from './index'
import { createPgBossJobQueue } from './infrastructure'
import { captureLogs } from './testing'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * Queue seam: the caller enqueues through the JobQueue port inside its
 * tenant transaction. The next job the worker takes is the observation.
 * A committed job is taken as well, so an empty queue cannot pass this test
 * by never storing anything.
 */
const databaseUrl = process.env.DATABASE_URL
const authDatabaseUrl = process.env.AUTH_DATABASE_URL
const queueDatabaseUrl = process.env.QUEUE_DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')
if (!authDatabaseUrl)
  throw new Error('AUTH_DATABASE_URL is required (the transferpro_auth role)')
if (!queueDatabaseUrl)
  throw new Error('QUEUE_DATABASE_URL is required (the transferpro_queue role)')

const env = parseAppEnv({
  DATABASE_URL: databaseUrl,
  AUTH_DATABASE_URL: authDatabaseUrl,
  QUEUE_DATABASE_URL: queueDatabaseUrl,
  BETTER_AUTH_SECRET: 'transferpro-test-secret-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
})

const tenantA = '33333333-3333-4333-8333-333333333333'
const tenantB = '44444444-4444-4444-8444-444444444444'
const queueName = 'foundation_rollback'
const sessionQueue = 'foundation_session'

const settingsRows = z.object({
  rows: z.array(z.object({
    default_locale: z.string(),
    tenant_id: z.string(),
  })),
})

const appPool = new pg.Pool({ connectionString: databaseUrl })
const appDb = drizzle(appPool)

let queue: JobQueue

beforeAll(async () => {
  queue = await createPgBossJobQueue(env)
})

afterAll(async () => {
  await queue?.close()
  await appPool.end()
})

/** Thrown to abort the caller's transaction. Drizzle rolls it back. */
class RolledBack extends Error {
  constructor() {
    super('rollback')
    this.name = 'RolledBack'
  }
}

async function tenantTransaction(
  tenantId: string,
  run: (transaction: TenantTransaction) => Promise<void>,
  commit: boolean,
) {
  await appDb.transaction(async (transaction) => {
    await openTenantSession(transaction, { tenantId }, () => run(transaction))
    if (!commit)
      throw new RolledBack()
  })
}

it('a rolled-back tenant transaction leaves no job', async () => {
  await tenantTransaction(tenantA, transaction =>
    queue.enqueue({ tenantId: tenantA }, transaction, queueName, { token: 'kept' }), true)

  await expect(tenantTransaction(tenantA, transaction =>
    queue.enqueue({ tenantId: tenantA }, transaction, queueName, { token: 'dropped' }), false)).rejects.toThrow(RolledBack)

  const taken: unknown[] = []
  const first = await queue.handleNext(queueName, async (job) => {
    taken.push(job.data)
  })
  const second = await queue.handleNext(queueName, async (job) => {
    taken.push(job.data)
  })

  expect(taken).toEqual([{ token: 'kept' }])
  expect(first).toMatchObject({ tenantId: tenantA, data: { token: 'kept' } })
  expect(second).toBeNull()
})

it('handles the job inside the tenant session stamped at enqueue', async () => {
  await tenantTransaction(tenantA, async (transaction) => {
    await transaction.execute(sql`delete from app.tenant_settings`)
    await transaction.execute(sql`
      insert into app.tenant_settings (default_locale, time_zone)
      values ('hr', 'Europe/Zagreb')
    `)
    // The payload names Tenant B. The session still has to be Tenant A.
    await queue.enqueue({ tenantId: tenantA }, transaction, sessionQueue, { tenantId: tenantB })
  }, true)

  await tenantTransaction(tenantB, async (transaction) => {
    await transaction.execute(sql`delete from app.tenant_settings`)
    await transaction.execute(sql`
      insert into app.tenant_settings (default_locale, time_zone)
      values ('en', 'Europe/London')
    `)
  }, true)

  let seen: { default_locale: string, tenant_id: string }[] = []
  const job = await queue.handleNext(sessionQueue, async (_queued, scope) => {
    const selected = settingsRows.parse(await scope.transaction.execute(sql`
      select default_locale, app.current_tenant_id() as tenant_id
      from app.tenant_settings
    `))
    seen = selected.rows
  })

  expect(job).toMatchObject({ tenantId: tenantA, data: { tenantId: tenantB } })
  expect(seen).toEqual([{ default_locale: 'hr', tenant_id: tenantA }])
})

it('restores the request id stamped at enqueue inside the tenant session', async () => {
  const logQueue = 'foundation_request'
  while (await queue.handleNext(logQueue, async () => {})) {
    // A failed earlier run may have left a job. Drop it before this case.
  }

  const logs = captureLogs()
  const request = '6b1e0c3a-2222-4222-8222-222222222222'

  await runWithRequestId(request, () =>
    tenantTransaction(tenantA, transaction =>
      queue.enqueue({ tenantId: tenantA }, transaction, logQueue, { n: 1 }), true))

  await queue.handleNext(logQueue, async () => {
    logs.logger.info({ event: 'job' })
  })
  logs.logger.info({ event: 'after' })

  const lines = logs.lines()
  expect(lines[0]).toMatchObject({ event: 'job', request_id: request, tenant_id: tenantA })
  expect(lines[1]?.request_id).toBeUndefined()
  expect(lines[1]?.tenant_id).toBeUndefined()
})

it('the queue role cannot read tenant or auth tables, and the app role cannot create queue objects', async () => {
  const queuePool = new pg.Pool({ connectionString: queueDatabaseUrl })
  const queueClient = await queuePool.connect()
  try {
    await expect(queueClient.query('select default_locale from app.tenant_settings')).rejects.toThrow(/permission denied/)
    await expect(queueClient.query('select email from auth."user"')).rejects.toThrow(/permission denied/)
    const databaseCreate = await queueClient.query(
      `select has_database_privilege('transferpro_queue', current_database(), 'CREATE') as can_create`,
    )
    expect(databaseCreate.rows).toEqual([{ can_create: false }])
  }
  finally {
    queueClient.release()
    await queuePool.end()
  }

  const appClient = await appPool.connect()
  try {
    await expect(appClient.query('create table pgboss.not_allowed (id int)')).rejects.toThrow(/permission denied/)

    const owner = await appClient.query(
      `select nspowner::regrole::text as owner from pg_namespace where nspname = 'pgboss'`,
    )
    expect(owner.rows).toEqual([{ owner: 'transferpro_queue' }])

    const tables = await appClient.query<{
      owner: string
      can_select: boolean
      can_insert: boolean
      can_update: boolean
      can_delete: boolean
      can_truncate: boolean
    }>(`
      select pg_get_userbyid(c.relowner)::text as owner,
             has_table_privilege('transferpro_app', c.oid, 'SELECT') as can_select,
             has_table_privilege('transferpro_app', c.oid, 'INSERT') as can_insert,
             has_table_privilege('transferpro_app', c.oid, 'UPDATE') as can_update,
             has_table_privilege('transferpro_app', c.oid, 'DELETE') as can_delete,
             has_table_privilege('transferpro_app', c.oid, 'TRUNCATE') as can_truncate
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pgboss' and c.relkind = 'r'
    `)
    expect(tables.rows.length).toBeGreaterThan(0)
    for (const row of tables.rows) {
      expect(row).toMatchObject({
        owner: 'transferpro_queue',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
        can_truncate: false,
      })
    }
  }
  finally {
    appClient.release()
  }
})
