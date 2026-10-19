import type { ScheduleClash } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'
import { capacityPorts, judgeRideCapacity, RideOverlapError, RideUnavailableError } from '../../capacity'
import { RideNotFoundError } from './assign'
import { rideOccupation } from './occupation-port'
import { toInstantDate } from './ride-occupation'

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
 * Ask capacity whether this Ride may hold this Driver and this Vehicle at
 * its stored times (ADR-0029, ADR-0034). Capacity judges; transfers turns
 * an unavailability window or a true overlap into a refusal unless
 * `confirm` is set. One confirmation passes both. When both apply, the
 * refusal is `ride_unavailable`: only the server knows the windows, while
 * the browser can still judge the overlap itself. A tight relocation gap
 * is returned and does not refuse.
 *
 * The caller has already taken `lockTenantCapacity` after its own row
 * locks and refusals, so the occupation capacity reads through the port
 * is every committed capacity write of this Tenant.
 */
export async function checkRideCapacity(
  transaction: TenantTransaction,
  input: ScheduleCheck,
): Promise<ScheduleClash[]> {
  const subject = subjectRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select t.pickup_at as "pickupAt", t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${input.rideId}
  `), 'Ride schedule check failed')).rows[0]
  if (!subject)
    throw new RideNotFoundError()

  const verdict = await judgeRideCapacity(capacityPorts(transaction, rideOccupation(transaction)), {
    rideId: input.rideId,
    driverId: input.driverId,
    vehicleId: input.vehicleId,
    pickupAt: toInstantDate(subject.pickupAt),
    landingAt: subject.landingAt == null ? null : toInstantDate(subject.landingAt),
  })
  if (input.confirm)
    return [...verdict.tightGaps]
  if ((verdict.unavailable?.length ?? 0) > 0)
    throw new RideUnavailableError()
  if (verdict.overlaps.length > 0)
    throw new RideOverlapError()
  return [...verdict.tightGaps]
}
