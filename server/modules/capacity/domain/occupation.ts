import type { ScheduleRide, ScheduleVerdict, UnavailableResource } from '../../../../shared'
import { judgeSchedule } from '../../../../shared'

/**
 * One Ride that occupies time, as the occupation port answers (ADR-0034).
 * Assigned and accepted Rides name a Driver and a Vehicle. A handed-off
 * Ride names a Partner and neither of those: it does not occupy the Partner.
 */
export interface OccupyingRide {
  readonly rideId: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/** The two Tenant minute counts the occupied window needs (ADR-0029). */
export interface CapacityMinutes {
  readonly transferDurationMinutes: number
  readonly relocationGapMinutes: number
}

/**
 * What capacity says about one Ride. A true overlap is in `overlaps`; the
 * caller decides whether that refuses the command. A gap shorter than the
 * relocation gap is in `tightGaps` and never refuses. `fullyBooked` is the
 * hard block (ADR-0034): no free Driver with a free Vehicle, and no free
 * Partner. The caller refuses an assignment or a handoff from it, and
 * confirming does not pass it. A Transfer save only warns.
 */
export interface CapacityVerdict extends ScheduleVerdict {
  /** The Driver, the Vehicle, the Partner, or a pair, that a window covers (ADR-0034). Absent when none is. */
  readonly unavailable?: readonly UnavailableResource[]
  readonly fullyBooked: boolean
}

/**
 * The occupied window the shared judge reads. A handed-off Ride has no
 * Driver or Vehicle, so it is not a schedule Ride. Null means leave it out.
 */
export function toScheduleRide(ride: OccupyingRide): ScheduleRide | null {
  if (ride.driverId === null || ride.vehicleId === null)
    return null
  return {
    rideId: ride.rideId,
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
    pickupAt: ride.pickupAt,
    landingAt: ride.landingAt,
  }
}

/**
 * Judge `subject` against the Rides that occupy its Driver or its Vehicle,
 * with the ADR-0029 rule from the shared contract, unchanged.
 */
export function judgeOccupation(
  subject: ScheduleRide,
  occupying: readonly OccupyingRide[],
  minutes: CapacityMinutes,
): ScheduleVerdict {
  return judgeSchedule(
    subject,
    occupying.flatMap((ride) => {
      const schedule = toScheduleRide(ride)
      return schedule === null ? [] : [schedule]
    }),
    minutes.transferDurationMinutes,
    minutes.relocationGapMinutes,
  )
}
