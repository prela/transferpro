import type { AppEnv, Logger, TenantTransaction } from '../../../core/index'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { PgBoss } from 'pg-boss'
import { FLIGHT_ASK_EVERY_MINUTES } from '../../../../shared'
import { getLogger, loadAppEnv, openTenantSession } from '../../../core/index'
import { askFlightLandings, noFlightStatusVendor } from './flight-landing'

/** pg-boss queue. The payload is empty: no flight number, guest name, or code. */
export const FLIGHT_LANDING_QUEUE = 'flight-landing'

let started = false

/**
 * Schedule the ask every 15 minutes and run it when the job is due.
 * The job lists Tenant ids from their rows, then opens one session each.
 * A job started here carries no request id. There is no vendor behind the port.
 */
export async function startFlightLandingWorker(env: AppEnv = loadAppEnv(), log: Logger = getLogger()): Promise<void> {
  if (started)
    return
  started = true
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool)
  const boss = new PgBoss({
    connectionString: env.QUEUE_DATABASE_URL,
    schema: 'pgboss',
    createSchema: false,
    application_name: 'transferpro-flight-landing',
  })
  await boss.start()
  await boss.createQueue(FLIGHT_LANDING_QUEUE)
  // 15 minutes. The ask does not sleep; the schedule is this expression.
  await boss.schedule(FLIGHT_LANDING_QUEUE, `*/${FLIGHT_ASK_EVERY_MINUTES} * * * *`, {})
  await boss.work(FLIGHT_LANDING_QUEUE, async () => {
    const now = new Date()
    const listed = await pool.query<{ tenant_id: string }>(
      'select tenant_id from app.tenants_due_flight_landing($1)',
      [now],
    )
    await askFlightLandings({
      now,
      tenantIds: listed.rows.map(row => row.tenant_id),
      withTenant: async (tenantId, run) => {
        await db.transaction(async (transaction) => {
          await openTenantSession(transaction, { tenantId }, () => run(transaction as TenantTransaction))
        })
      },
      status: noFlightStatusVendor,
      log,
    })
  })
}
