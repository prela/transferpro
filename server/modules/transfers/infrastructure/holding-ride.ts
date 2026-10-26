import type { RideState } from '../../../../shared'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { z } from 'zod'
import { rideHoldsDriverSession } from '../../../../shared'
import { loadAppEnv, openTenantSession } from '../../../core/index'

/**
 * The Driver's unfinished Rides in the active Tenant. Another Tenant's
 * rows are hidden by the tenant session. Tenancy calls this through the
 * port and does not import this module.
 */
const rideRow = z.object({
  state: z.string(),
  must_accept: z.boolean().nullable(),
  driver_id: z.string().nullable(),
  pickup_at: z.coerce.date(),
  time_zone: z.string().min(1),
  operational_day_start_hour: z.number().int(),
})

let pool: pg.Pool | undefined
let database: ReturnType<typeof drizzle> | undefined

function rides(): ReturnType<typeof drizzle> {
  if (!database) {
    pool = new pg.Pool({ connectionString: loadAppEnv().DATABASE_URL, max: 2 })
    database = drizzle(pool)
  }
  return database
}

/** Tests close the pool. The server keeps it. */
export async function closeDriverHoldingRides(): Promise<void> {
  const current = pool
  pool = undefined
  database = undefined
  await current?.end()
}

export async function driverHasHoldingRide(input: {
  readonly tenantId: string
  readonly userId: string
  readonly now: Date
}): Promise<boolean> {
  const selected = await rides().transaction(async (transaction) => {
    return openTenantSession(transaction, { tenantId: input.tenantId }, async () => {
      return transaction.execute(sql`
        select r.state, r.must_accept, r.driver_id, t.pickup_at,
               s.time_zone, s.operational_day_start_hour
        from app.rides as r
        join app.transfers as t on t.id = r.transfer_id
        join app.drivers as d on d.id = r.driver_id
        join app.tenant_settings as s on s.tenant_id = r.tenant_id
        where d.member_user_id = ${input.userId}
          and r.state in ('assigned', 'accepted')
      `)
    })
  })
  const rows = z.object({ rows: z.array(rideRow) }).parse(selected).rows
  return rows.some(row => rideHoldsDriverSession({
    state: row.state as RideState,
    mustAccept: row.must_accept,
    driverId: row.driver_id,
    pickupAt: row.pickup_at,
    timeZone: row.time_zone,
    operationalDayStartHour: row.operational_day_start_hour,
  }, input.now))
}
