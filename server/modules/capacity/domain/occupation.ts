import type { ScheduleClash, ScheduleRide } from '../../../../shared'
import { judgeSchedule } from '../../../../shared'

/**
 * One Ride that occupies time, as the occupation port answers (ADR-0034).
 * Today that is an assigned or accepted Ride. Handed-off Rides join with
 * the Partner windows ticket (ADR-0048), so `partnerId` is always null.
 */
export interface OccupyingRide {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
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
 * What capacity says about one Ride's Driver and Vehicle. A true overlap
 * is in `overlaps`; the caller decides whether that refuses the command.
 * A gap shorter than the relocation gap is in `tightGaps` and never refuses.
 */
export interface CapacityVerdict {
  readonly overlaps: readonly ScheduleClash[]
  readonly tightGaps: readonly ScheduleClash[]
}

/** The occupied window the shared judge reads. The Partner plays no part in a Driver or Vehicle clash. */
export function toScheduleRide(ride: OccupyingRide): ScheduleRide {
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
): CapacityVerdict {
  return judgeSchedule(
    subject,
    occupying.map(toScheduleRide),
    minutes.transferDurationMinutes,
    minutes.relocationGapMinutes,
  )
}
