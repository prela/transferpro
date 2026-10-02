import type { DrizzleTransactionLike } from 'pg-boss'
import type { AppEnv, JobHandlerScope, JobQueue, QueuedJob, TenantTransaction } from './index'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { fromDrizzle, PgBoss } from 'pg-boss'
import { z } from 'zod'

/**
 * What `send` stores. The tenant is outside the caller's payload so a
 * field named tenantId in `data` cannot choose the session.
 */
const envelopeSchema = z.object({
  tenantId: z.uuid(),
  data: z.unknown(),
})

/**
 * pg-boss on the queue role, reached through the JobQueue port.
 * Schema `pgboss` is created by the migration and owned by transferpro_queue.
 * `createSchema` stays off: transferpro_queue has no CREATE on the database.
 * The migration already created schema pgboss and the app role's grants.
 * No queue is registered here.
 * Callers name a queue when they enqueue.
 */
export async function createPgBossJobQueue(env: AppEnv): Promise<JobQueue> {
  const appPool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const appDb = drizzle(appPool)
  const boss = new PgBoss({
    connectionString: env.QUEUE_DATABASE_URL,
    schema: 'pgboss',
    createSchema: false,
    application_name: 'transferpro-queue',
  })

  // An unhandled 'error' event would crash the process.
  let bossError: Error | undefined
  boss.on('error', (error) => {
    bossError = error
  })
  await boss.start()

  const ensured = new Set<string>()

  function raiseIfBossFailed() {
    if (bossError)
      throw bossError
  }

  // Queue rows are definitions, not jobs. They commit on the queue role
  // even when the caller's transaction later rolls the job back.
  async function ensureQueue(name: string) {
    if (ensured.has(name))
      return
    await boss.createQueue(name)
    ensured.add(name)
  }

  return {
    async enqueue(context, transaction, name, data) {
      raiseIfBossFailed()
      const tenantId = z.uuid().parse(context.tenantId)
      await ensureQueue(name)
      // fromDrizzle runs the insert on the caller's transaction, so a
      // rollback drops the job together with the rest of that unit of work.
      const id = await boss.send(name, { tenantId, data }, {
        db: fromDrizzle(asDrizzle(transaction), sql),
      })
      if (!id)
        throw new Error(`pg-boss did not accept a job on ${name}`)
    },

    async handleNext(name, handle) {
      raiseIfBossFailed()
      await ensureQueue(name)
      // Fetch, the tenant session, the handler, and completion share one
      // app-role transaction. The queue role has no grant on schema app,
      // so the session cannot be opened on the queue connection.
      return appDb.transaction(async (transaction) => {
        const db = fromDrizzle(transaction, sql)
        const [job] = await boss.fetch(name, { batchSize: 1, db })
        if (!job)
          return null

        const envelope = envelopeSchema.parse(job.data)
        // Third argument true: the setting dies with this transaction.
        await transaction.execute(sql`select set_config('app.tenant_id', ${envelope.tenantId}, true)`)
        const queued: QueuedJob = {
          id: job.id,
          name: job.name,
          tenantId: envelope.tenantId,
          data: envelope.data,
        }
        const scope: JobHandlerScope = { transaction }
        await handle(queued, scope)
        await boss.complete(name, job.id, null, { db })
        return queued
      })
    },

    async close() {
      await boss.stop({ graceful: false, close: true })
      await appPool.end()
    },
  }
}

function asDrizzle(transaction: TenantTransaction): DrizzleTransactionLike {
  return transaction as DrizzleTransactionLike
}

/**
 * One row of the catalog probe. Zod is the boundary: pg's row shape is not
 * trusted, and a missing row means the connection has no role to judge.
 */
const roleProbeSchema = z.object({
  role: z.string(),
  rolsuper: z.boolean(),
  rolbypassrls: z.boolean(),
  owns_app_table: z.boolean(),
})

/**
 * Boot refuses this connection when its role could skip tenant RLS or is
 * the migrator. Superuser and BYPASSRLS ignore policies. Owning a table in
 * schema `app` is the migrator's privilege, not a runtime role's.
 * The connection string is not included in the error: it carries a password.
 */
export async function assertRuntimeRole(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const result = await pool.query(`
      select
        current_user as role,
        rolsuper,
        rolbypassrls,
        exists (
          select 1
          from pg_class as c
          join pg_namespace as n on n.oid = c.relnamespace
          where n.nspname = 'app'
            and c.relkind in ('r', 'p')
            and c.relowner = pg_roles.oid
        ) as owns_app_table
      from pg_roles
      where rolname = current_user
    `)
    const row = roleProbeSchema.parse(result.rows[0])
    const reasons: string[] = []
    if (row.rolsuper)
      reasons.push('is superuser')
    if (row.rolbypassrls)
      reasons.push('has BYPASSRLS')
    if (row.owns_app_table)
      reasons.push('owns a table in schema app')
    if (reasons.length > 0)
      throw new Error(`refusing to start: ${row.role} ${reasons.join(', ')}`)
  }
  finally {
    await pool.end()
  }
}

/**
 * The three runtime connections, in app, auth, queue order.
 * The first over-privileged role stops boot; the migrator URL is not among them.
 */
export async function assertRuntimeRoles(env: AppEnv): Promise<void> {
  await assertRuntimeRole(env.DATABASE_URL)
  await assertRuntimeRole(env.AUTH_DATABASE_URL)
  await assertRuntimeRole(env.QUEUE_DATABASE_URL)
}
