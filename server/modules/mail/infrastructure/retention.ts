import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import pg from 'pg'
import { z } from 'zod'
import { getLogger, loadAppEnv } from '../../../core/index'
import { mailRetentionCutoff } from '../domain/retention'
import { deleteOutboxEntriesBefore } from './outbox'
import { closeWithMailOutboxQueue, mailOutboxQueue } from './queue'

/** Daily tick. Its payload is empty. It is not one Tenant. */
export const MAIL_RETENTION_TICK = 'mail-outbox-retention'

/** One Tenant's delete, stamped on the envelope at publish. The handler does not choose the id. */
export const MAIL_RETENTION_DELETE = 'mail-outbox-retention-tenant'

/** Once a day at 03:15 UTC, outside office hours in Europe. */
export const MAIL_RETENTION_CRON = '15 3 * * *'

const askedAtSchema = z.object({ askedAt: z.iso.datetime() })

/**
 * Register the daily tick and the per-Tenant delete on the JobQueue port (ADR-0045).
 * The tick lists the Tenants that hold an entry older than 90 days and
 * publishes one job each. That job runs on the Tenant's session, deletes the
 * Tenant's old entries in every state, and logs the count only.
 */
export async function registerMailOutboxRetention(
  queue: JobQueue,
  options: {
    readonly log: Logger
    readonly listTenantIds: (before: Date) => Promise<readonly string[]>
    readonly now?: () => Date
  },
): Promise<void> {
  const now = options.now ?? (() => new Date())
  await queue.schedule(MAIL_RETENTION_TICK, MAIL_RETENTION_CRON, {})
  await queue.workScheduled(MAIL_RETENTION_TICK, async (_job, publish) => {
    const askedAt = now()
    for (const tenantId of await options.listTenantIds(mailRetentionCutoff(askedAt)))
      await publish(tenantId, MAIL_RETENTION_DELETE, { askedAt: askedAt.toISOString() })
  })
  await queue.work(MAIL_RETENTION_DELETE, async (job, scope) => {
    const asked = new Date(askedAtSchema.parse(job.data).askedAt)
    // The earlier instant wins, so a payload from the future cannot reach an entry 90 days old or newer.
    const asOf = new Date(Math.min(asked.getTime(), now().getTime()))
    const deleted = await deleteOutboxEntriesBefore(scope.transaction, mailRetentionCutoff(asOf))
    options.log.info({ event: 'mail_outbox.retention_deleted', deleted })
  })
}

/**
 * The Tenants holding an entry created before `before`. The security definer
 * function returns Tenant ids only, so the app role sees no other column.
 */
export async function listTenantsWithOutboxBefore(pool: pg.Pool, before: Date): Promise<string[]> {
  const listed = await pool.query('select tenant_id from app.tenants_with_mail_outbox_before($1)', [before])
  return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
}

let starting: Promise<void> | undefined

/**
 * Run the retention on the process's one mail queue. A second call does nothing.
 * `closeMailOutboxQueue` also ends the listing pool and lets a later call start again.
 */
export function startMailOutboxRetention(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  starting ??= start(env, log)
  return starting
}

async function start(env: AppEnv, log: Logger): Promise<void> {
  const queue = await mailOutboxQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
  closeWithMailOutboxQueue(async () => {
    starting = undefined
    await pool.end()
  })
  await registerMailOutboxRetention(queue, {
    log,
    listTenantIds: before => listTenantsWithOutboxBefore(pool, before),
  })
}
