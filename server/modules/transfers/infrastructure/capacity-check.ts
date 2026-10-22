import type { ScheduleClash } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'
import { capacityPorts, FullyBookedError, judgePartnerCapacity, judgeRideCapacity, readFullyBooked, RideOverlapError, RideUnavailableError, tenantFleet } from '../../capacity'
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
  /**
   * Assign, a Vehicle change, and a reassignment refuse a fully booked
   * window. A Transfer correction passes false: it saves and warns.
   */
  readonly blockFullyBooked: boolean
}

export interface RideCapacityCheck {
  readonly relocationWarnings: ScheduleClash[]
  readonly fullyBooked: boolean
}

/**
 * Ask capacity whether this Ride may hold this Driver and this Vehicle at
 * its stored times (ADR-0029, ADR-0034). Capacity judges; transfers turns
 * an unavailability window or a true overlap into a refusal unless
 * `confirm` is set. One confirmation passes both. It does not pass a
 * fully booked window. When both a window and an overlap apply, the
 * refusal is `ride_unavailable`: only the server knows the windows, while
 * the browser can still judge the overlap itself. `fully_booked` comes
 * before either of those. A tight relocation gap is returned and does
 * not refuse.
 *
 * The caller has already taken `lockTenantCapacity` after its own row
 * locks and refusals, so the occupation capacity reads through the port
 * is every committed capacity write of this Tenant.
 */
async function loadSubject(transaction: TenantTransaction, rideId: string) {
  const subject = subjectRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select t.pickup_at as "pickupAt", t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${rideId}
  `), 'Ride schedule check failed')).rows[0]
  if (!subject)
    throw new RideNotFoundError()
  return {
    pickupAt: toInstantDate(subject.pickupAt),
    landingAt: subject.landingAt == null ? null : toInstantDate(subject.landingAt),
  }
}

export async function checkRideCapacity(
  transaction: TenantTransaction,
  input: ScheduleCheck,
): Promise<RideCapacityCheck> {
  const subject = await loadSubject(transaction, input.rideId)
  const ports = capacityPorts(transaction, rideOccupation(transaction))
  const fleet = tenantFleet(transaction)

  const verdict = await judgeRideCapacity(ports, {
    rideId: input.rideId,
    driverId: input.driverId,
    vehicleId: input.vehicleId,
    pickupAt: subject.pickupAt,
    landingAt: subject.landingAt,
  }, fleet)
  if (verdict.fullyBooked && input.blockFullyBooked)
    throw new FullyBookedError()
  if (input.confirm)
    return { relocationWarnings: [...verdict.tightGaps], fullyBooked: verdict.fullyBooked }
  if ((verdict.unavailable?.length ?? 0) > 0)
    throw new RideUnavailableError()
  if (verdict.overlaps.length > 0)
    throw new RideOverlapError()
  return { relocationWarnings: [...verdict.tightGaps], fullyBooked: verdict.fullyBooked }
}

/**
 * The fully booked warning on a Transfer save (ADR-0034). Creating one,
 * and correcting one that is not judged as an overlap, still saves.
 * An assigned pair that is itself free is not a fully booked window.
 */
export async function transferFullyBooked(
  transaction: TenantTransaction,
  input: {
    readonly rideId: string
    readonly pickupAt: Date
    readonly landingAt: Date | null
    readonly driverId: string | null
    readonly vehicleId: string | null
  },
): Promise<boolean> {
  const ports = capacityPorts(transaction, rideOccupation(transaction))
  const fleet = tenantFleet(transaction)
  if (input.driverId !== null && input.vehicleId !== null) {
    const verdict = await judgeRideCapacity(ports, {
      rideId: input.rideId,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      pickupAt: input.pickupAt,
      landingAt: input.landingAt,
    }, fleet)
    return verdict.fullyBooked
  }
  const minutes = await ports.minutes()
  return readFullyBooked(ports, fleet, {
    rideId: input.rideId,
    pickupAt: input.pickupAt,
    landingAt: input.landingAt,
    durationMinutes: minutes.transferDurationMinutes,
  })
}

/**
 * A handoff or a change of Partner (ADR-0034). A fully booked window is
 * 409 `fully_booked` and `confirm` does not pass it. Otherwise an
 * unavailability window over the Partner is 409 `ride_unavailable` and
 * writes nothing. `confirm: true` passes that window. A Ride handed to
 * the Partner does not occupy them, so there is no overlap to confirm.
 * The caller already took the Tenant capacity lock and refused an
 * archived Partner.
 */
export async function checkPartnerCapacity(
  transaction: TenantTransaction,
  input: { readonly rideId: string, readonly partnerId: string, readonly confirm: boolean },
): Promise<void> {
  const subject = await loadSubject(transaction, input.rideId)
  const verdict = await judgePartnerCapacity(capacityPorts(transaction, rideOccupation(transaction)), {
    rideId: input.rideId,
    partnerId: input.partnerId,
    pickupAt: subject.pickupAt,
    landingAt: subject.landingAt,
  }, tenantFleet(transaction))
  if (verdict.fullyBooked)
    throw new FullyBookedError()
  if (input.confirm)
    return
  if ((verdict.unavailable?.length ?? 0) > 0)
    throw new RideUnavailableError()
}
