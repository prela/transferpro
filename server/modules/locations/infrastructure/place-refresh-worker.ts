import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import type { PlaceReferenceCheck } from '../maps-port'
import pg from 'pg'
import { z } from 'zod'
import { getLogger, loadAppEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { mapsForApp } from './maps'
import { refreshPlaceReferences } from './place-refresh'

/**
 * Nightly tick. Its payload is empty: no reference, address, or Tenant.
 * It is not one Tenant. Each Tenant is a separate job on the check queue.
 */
export const PLACE_REFRESH_TICK = 'place-refresh'

/**
 * One Tenant, stamped on the envelope at enqueue. The handler does not
 * choose the id. The name is `place-refresh-check`; the constant ends in
 * `_ASK` so the payload registry sees it beside the other per-Tenant jobs.
 */
export const PLACE_REFRESH_ASK = 'place-refresh-check'

/** Once a night at 03:00 UTC, before the other daily ticks. */
export const PLACE_REFRESH_CRON = '0 3 * * *'

const askedAtSchema = z.object({
  askedAt: z.iso.datetime(),
})

let started = false

/**
 * Register the nightly tick and the per-Tenant check on the JobQueue port.
 * With `MAPS=none` nothing is scheduled: stored references stay, and the
 * next night after `google` returns picks up the ones that aged.
 * The tick lists Tenants that have a due reference and publishes one check
 * each. The payload is the tick's instant only. The port restores a request
 * id when the envelope has one. A tick has no request, so none is invented.
 */
export async function registerPlaceRefresh(
  queue: JobQueue,
  options: {
    readonly maps: 'google' | 'none'
    readonly log: Logger
    readonly places: { checkPlaceRef: (placeRef: string) => Promise<PlaceReferenceCheck> }
    readonly listTenantIds: (now: Date) => Promise<readonly string[]>
    readonly now?: () => Date
  },
): Promise<void> {
  if (options.maps !== 'google')
    return
  const now = options.now ?? (() => new Date())
  await queue.schedule(PLACE_REFRESH_TICK, PLACE_REFRESH_CRON, {})
  await queue.workScheduled(PLACE_REFRESH_TICK, async (_job, publish) => {
    const askedAt = now()
    for (const tenantId of await options.listTenantIds(askedAt))
      await publish(tenantId, PLACE_REFRESH_ASK, { askedAt: askedAt.toISOString() })
  })
  await queue.work(PLACE_REFRESH_ASK, async (job, scope) => {
    const asked = new Date(askedAtSchema.parse(job.data).askedAt)
    // The earlier instant wins, so a payload from the future cannot stamp a reference that is not due yet.
    const asOf = new Date(Math.min(asked.getTime(), now().getTime()))
    await refreshPlaceReferences({
      now: asOf,
      transaction: scope.transaction,
      places: options.places,
      log: options.log,
    })
  })
}

/**
 * Tenants with an active google reference that is unchecked or older than
 * 12 months before `now`. The function returns Tenant ids only.
 */
export async function listTenantsDuePlaceRefresh(pool: pg.Pool, now: Date): Promise<string[]> {
  const listed = await pool.query(
    'select tenant_id from app.tenants_due_place_refresh($1)',
    [now],
  )
  return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
}

/**
 * Schedule the check when `MAPS=google`, on the one pg-boss behind
 * `createPgBossJobQueue`. `MAPS=none` returns before a queue or a pool
 * exists, so no tick is registered.
 */
export async function startPlaceRefreshWorker(env: AppEnv = loadAppEnv(), log?: Logger): Promise<void> {
  if (env.MAPS !== 'google')
    return
  if (started)
    return
  started = true
  const logger = log ?? getLogger()
  const queue = await createPgBossJobQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  await registerPlaceRefresh(queue, {
    maps: env.MAPS,
    log: logger,
    places: mapsForApp(env),
    listTenantIds: now => listTenantsDuePlaceRefresh(pool, now),
  })
}
