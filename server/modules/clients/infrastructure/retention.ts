import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import pg from 'pg'
import { z } from 'zod'
import { getLogger, loadAppEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { contactPersonRetentionCutoff } from '../domain/retention'
import { deleteContactPersonsRemovedBefore } from './contact-persons'

/** Daily tick. Its payload is empty. It is not one Tenant. */
export const CONTACT_PERSON_RETENTION_TICK = 'contact-person-retention'

/** One Tenant's delete, stamped on the envelope at publish. The handler does not choose the id. */
export const CONTACT_PERSON_RETENTION_DELETE = 'contact-person-retention-tenant'

/** Once a day at 03:45 UTC, outside office hours in Europe and apart from the other retention jobs. */
export const CONTACT_PERSON_RETENTION_CRON = '45 3 * * *'

const askedAtSchema = z.object({ askedAt: z.iso.datetime() })

/**
 * Register the daily tick and the per-Tenant delete on the JobQueue port
 * (ADR-0049), as the unavailability-window retention does. The tick lists
 * the Tenants holding a contact person removed more than 90 days ago and
 * publishes one job each. That job runs on the Tenant's session, deletes
 * those rows, and logs the count only: no id, no name, and no contact.
 */
export async function registerContactPersonRetention(
  queue: JobQueue,
  options: {
    readonly log: Logger
    readonly listTenantIds: (before: Date) => Promise<readonly string[]>
    readonly now?: () => Date
  },
): Promise<void> {
  const now = options.now ?? (() => new Date())
  await queue.schedule(CONTACT_PERSON_RETENTION_TICK, CONTACT_PERSON_RETENTION_CRON, {})
  await queue.workScheduled(CONTACT_PERSON_RETENTION_TICK, async (_job, publish) => {
    const askedAt = now()
    for (const tenantId of await options.listTenantIds(contactPersonRetentionCutoff(askedAt)))
      await publish(tenantId, CONTACT_PERSON_RETENTION_DELETE, { askedAt: askedAt.toISOString() })
  })
  await queue.work(CONTACT_PERSON_RETENTION_DELETE, async (job, scope) => {
    const asked = new Date(askedAtSchema.parse(job.data).askedAt)
    // The earlier instant wins, so a payload from the future cannot reach a person removed 90 days ago or later.
    const asOf = new Date(Math.min(asked.getTime(), now().getTime()))
    const deleted = await deleteContactPersonsRemovedBefore(scope.transaction, contactPersonRetentionCutoff(asOf))
    options.log.info({ event: 'contact_person.retention_deleted', deleted })
  })
}

/**
 * The Tenants holding a contact person removed before `before`. The security
 * definer function returns Tenant ids only, so the app role sees no other column.
 */
export async function listTenantsWithContactPersonsRemovedBefore(pool: pg.Pool, before: Date): Promise<string[]> {
  const listed = await pool.query('select tenant_id from app.tenants_with_contact_persons_removed_before($1)', [before])
  return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
}

let starting: Promise<void> | undefined

/** Run the retention on its own queue for this process. A second call does nothing. */
export function startContactPersonRetention(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  starting ??= start(env, log)
  return starting
}

async function start(env: AppEnv, log: Logger): Promise<void> {
  const queue = await createPgBossJobQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
  await registerContactPersonRetention(queue, {
    log,
    listTenantIds: before => listTenantsWithContactPersonsRemovedBefore(pool, before),
  })
}
