import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import pg from 'pg'
import { z } from 'zod'
import { getLogger, loadAppEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { unavailabilityRetentionCutoff } from '../domain/retention'
import { deleteWindowsEndedBefore } from './unavailability-store'

/** Daily tick. Its payload is empty. It is not one Tenant. */
export const UNAVAILABILITY_RETENTION_TICK = 'unavailability-retention'

/** One Tenant's delete, stamped on the envelope at publish. The handler does not choose the id. */
export const UNAVAILABILITY_RETENTION_DELETE = 'unavailability-retention-tenant'

/** Once a day at 03:30 UTC, outside office hours in Europe and apart from the mail retention. */
export const UNAVAILABILITY_RETENTION_CRON = '30 3 * * *'

const askedAtSchema = z.object({ askedAt: z.iso.datetime() })

/**
 * Register the daily tick and the per-Tenant delete on the JobQueue port
 * (ADR-0034), as the mail-outbox retention does. The tick lists the Tenants
 * holding a window that ended more than 90 days ago and publishes one job
 * each. That job runs on the Tenant's session, deletes those windows,
 * removed or not, and logs the count only: no id and no instant.
 */
export async function registerUnavailabilityRetention(
  queue: JobQueue,
  options: {
    readonly log: Logger
    readonly listTenantIds: (before: Date) => Promise<readonly string[]>
    readonly now?: () => Date
  },
): Promise<void> {
  const now = options.now ?? (() => new Date())
  await queue.schedule(UNAVAILABILITY_RETENTION_TICK, UNAVAILABILITY_RETENTION_CRON, {})
  await queue.workScheduled(UNAVAILABILITY_RETENTION_TICK, async (_job, publish) => {
    const askedAt = now()
    for (const tenantId of await options.listTenantIds(unavailabilityRetentionCutoff(askedAt)))
      await publish(tenantId, UNAVAILABILITY_RETENTION_DELETE, { askedAt: askedAt.toISOString() })
  })
  await queue.work(UNAVAILABILITY_RETENTION_DELETE, async (job, scope) => {
    const asked = new Date(askedAtSchema.parse(job.data).askedAt)
    // The earlier instant wins, so a payload from the future cannot reach a window that ended 90 days ago or later.
    const asOf = new Date(Math.min(asked.getTime(), now().getTime()))
    const deleted = await deleteWindowsEndedBefore(scope.transaction, unavailabilityRetentionCutoff(asOf))
    options.log.info({ event: 'unavailability.retention_deleted', deleted })
  })
}

/**
 * The Tenants holding a window that ended before `before`. The security
 * definer function returns Tenant ids only, so the app role sees no other column.
 */
export async function listTenantsWithWindowsEndedBefore(pool: pg.Pool, before: Date): Promise<string[]> {
  const listed = await pool.query('select tenant_id from app.tenants_with_unavailability_ended_before($1)', [before])
  return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
}

let starting: Promise<void> | undefined

/** Run the retention on its own queue for this process. A second call does nothing. */
export function startUnavailabilityRetention(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  starting ??= start(env, log)
  return starting
}

async function start(env: AppEnv, log: Logger): Promise<void> {
  const queue = await createPgBossJobQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
  await registerUnavailabilityRetention(queue, {
    log,
    listTenantIds: before => listTenantsWithWindowsEndedBefore(pool, before),
  })
}
