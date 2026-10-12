import type { AppEnv, JobQueue, Logger } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import type { FlightStatusPort } from './flight-landing'
import pg from 'pg'
import { z } from 'zod'
import { FLIGHT_ASK_EVERY_MINUTES } from '../../../../shared'
import { getLogger, loadAppEnv } from '../../../core/index'
import { createPgBossJobQueue } from '../../../core/infrastructure'
import { mailerForApp } from '../../tenancy'
import { noFlightStatusVendor, refreshFlightLandings } from './flight-landing'

/**
 * Recurring tick. Its payload is empty: no flight number, guest name, or code.
 * It is not one Tenant. Each due Tenant is a separate job on the ask queue.
 */
export const FLIGHT_LANDING_TICK = 'flight-landing'

/** One Tenant, stamped on the envelope at enqueue. The handler does not choose the id. */
export const FLIGHT_LANDING_ASK = 'flight-landing-ask'

const askedAtSchema = z.object({
  askedAt: z.iso.datetime(),
})

let started = false

/**
 * Register the 15-minute tick and the per-Tenant worker on the JobQueue port.
 * The tick lists Tenant ids and publishes one ask each. That job's envelope
 * carries the tenant and, when a request is open, the request id. The port
 * restores the id before it opens the session. A tick has no request, so
 * none is invented.
 */
export async function registerFlightLanding(
  queue: JobQueue,
  options: {
    readonly log: Logger
    readonly status: FlightStatusPort
    readonly notices: Pick<Mailer, 'notifyArrivalMoved'>
    readonly listTenantIds: (now: Date) => Promise<readonly string[]>
    readonly now?: () => Date
  },
): Promise<void> {
  const now = options.now ?? (() => new Date())
  await queue.schedule(FLIGHT_LANDING_TICK, `*/${FLIGHT_ASK_EVERY_MINUTES} * * * *`, {})
  await queue.workScheduled(FLIGHT_LANDING_TICK, async (_job, publish) => {
    const askedAt = now()
    const tenantIds = await options.listTenantIds(askedAt)
    for (const tenantId of tenantIds) {
      await publish(tenantId, FLIGHT_LANDING_ASK, { askedAt: askedAt.toISOString() })
    }
  })
  await queue.work(FLIGHT_LANDING_ASK, async (job, scope) => {
    const asked = askedAtSchema.parse(job.data)
    await refreshFlightLandings({
      now: new Date(asked.askedAt),
      transaction: scope.transaction,
      status: options.status,
      notices: options.notices,
      log: options.log,
    })
  })
}

/**
 * Schedule the ask and run it on the one pg-boss behind `createPgBossJobQueue`.
 * There is no vendor behind the status port.
 */
export async function startFlightLandingWorker(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  if (started)
    return
  started = true
  const queue = await createPgBossJobQueue(env)
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  await registerFlightLanding(queue, {
    log,
    status: noFlightStatusVendor,
    notices: mailerForApp(env),
    async listTenantIds(now) {
      const listed = await pool.query(
        'select tenant_id from app.tenants_due_flight_landing($1)',
        [now],
      )
      return z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(row => row.tenant_id)
    },
  })
}
