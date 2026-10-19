import type { ScheduleClash } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { judgeSchedule } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadTenantSettings } from '../../tenancy'
import { RideNotFoundError } from './assign'
import { readOccupyingRides, toScheduleRide } from './ride-occupation'

/**
 * The Driver or the Vehicle is already occupied on another Ride.
 * Nothing was written. `confirm: true` on the command is the only way through.
 */
export class RideOverlapError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_overlap'

  constructor() {
    super('Conflict')
    this.name = 'RideOverlapError'
  }
}

const subjectRows = z.object({
  rows: z.array(z.object({
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

export interface ScheduleCheck {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
  readonly confirm: boolean
}

/**
 * First key of the two-key advisory lock. Postgres keeps two-key locks
 * apart from one-key locks, so this never meets the member lock, which
 * is `pg_advisory_xact_lock(hashtext(organizationId))` (ADR-0014).
 */
const CAPACITY_LOCK_SPACE = 34

/**
 * Take the Tenant capacity lock (ADR-0034) on this transaction. The Tenant
 * is the session's `app.tenant_id`, never a request value; the uuid cast
 * fails, rather than locking nothing, when the session has no Tenant.
 * It waits with no timeout and is released at commit or rollback. Two
 * capacity writes of one Tenant run one after the other. Another Tenant's
 * key differs, so two Tenants never wait on each other.
 */
export async function lockTenantCapacity(transaction: TenantTransaction): Promise<void> {
  await hideDatabaseError(() => transaction.execute(sql`
    select pg_advisory_xact_lock(${sql.raw(String(CAPACITY_LOCK_SPACE))}, hashtext(current_setting('app.tenant_id')::uuid::text))
  `), 'Ride capacity lock failed')
}

/**
 * Assigned and accepted Rides occupy, including one already in progress.
 * Done, no-show, cancelled, and unassigned do not. The Ride being changed
 * is excluded. A true overlap refuses the command unless `confirm` is set.
 * A tight relocation gap is returned and does not refuse.
 *
 * Lock order (ADR-0034). The caller has already locked its Transfer and
 * Ride rows and made every refusal that needs no other row: role, input,
 * `stale_save`, and state. It then takes `lockTenantCapacity`, and only
 * after that reads a Driver, a Vehicle, or another Ride, this check included.
 * Occupation is read without row locks, so no lock cycle can form with the
 * Tenant lock, and the second of two concurrent commands sees the first.
 */
export async function checkRideSchedule(
  transaction: TenantTransaction,
  input: ScheduleCheck,
): Promise<ScheduleClash[]> {
  const settings = await loadTenantSettings(transaction)
  const subject = subjectRows.parse(await run(transaction, sql`
    select t.pickup_at as "pickupAt", t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${input.rideId}
  `)).rows[0]
  if (!subject)
    throw new RideNotFoundError()

  const occupying = await readOccupyingRides(transaction, {
    rideId: input.rideId,
    driverId: input.driverId,
    vehicleId: input.vehicleId,
  })

  const verdict = judgeSchedule(
    toScheduleRide({
      id: input.rideId,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      pickupAt: subject.pickupAt,
      landingAt: subject.landingAt,
    }),
    occupying,
    settings.transferDurationMinutes,
    settings.relocationGapMinutes,
  )
  if (verdict.overlaps.length > 0 && !input.confirm)
    throw new RideOverlapError()
  return [...verdict.tightGaps]
}

function run(transaction: TenantTransaction, query: ReturnType<typeof sql>): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride schedule check failed')
}
