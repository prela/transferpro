import type { ScheduleRide } from '../../../../shared'
import type { CapacityVerdict } from '../domain/occupation'
import type { CapacityPorts } from './ports'
import { occupiedEnd } from '../../../../shared'
import { judgeOccupation } from '../domain/occupation'
import { partnerUnavailable, unavailableResources } from '../domain/unavailability'

/**
 * The one capacity check for a command that writes a Driver and a Vehicle
 * onto a Ride: assign, a Vehicle change, a reassignment, and a judged
 * Transfer correction (ADR-0029, ADR-0034). `subject` is the Ride with the
 * Driver and the Vehicle it is about to hold, at its stored times.
 *
 * The caller holds the Tenant capacity lock, so the occupation and the
 * windows it reads are every other capacity write of this Tenant that has
 * committed. The verdict refuses nothing; the caller throws
 * `RideUnavailableError` or `RideOverlapError` unless confirmed.
 * `unavailable` is there only when a window covers the occupied window.
 */
export async function judgeRideCapacity(ports: CapacityPorts, subject: ScheduleRide): Promise<CapacityVerdict> {
  const minutes = await ports.minutes()
  const occupying = await ports.occupation.ridesOf({
    rideId: subject.rideId,
    driverId: subject.driverId,
    vehicleId: subject.vehicleId,
  })
  const windows = await ports.windows({
    driverIds: [subject.driverId],
    vehicleIds: [subject.vehicleId],
    partnerIds: [],
    from: subject.pickupAt,
    to: occupiedEnd(subject.pickupAt, subject.landingAt, minutes.transferDurationMinutes),
  })
  const verdict = judgeOccupation(subject, occupying, minutes)
  const unavailable = unavailableResources(subject, windows, minutes.transferDurationMinutes)
  return unavailable.length > 0 ? { ...verdict, unavailable } : verdict
}

/**
 * The capacity check for handing a Ride to a Partner, or changing the
 * Partner (ADR-0034, ADR-0048). A window over that Partner is
 * `unavailable: ['partner']`. A Ride already handed to the Partner does
 * not occupy them, so the verdict has no overlap and no tight gap.
 * The caller holds the Tenant capacity lock. The verdict refuses nothing.
 */
export async function judgePartnerCapacity(
  ports: CapacityPorts,
  subject: { readonly partnerId: string, readonly pickupAt: Date, readonly landingAt: Date | null },
): Promise<CapacityVerdict> {
  const minutes = await ports.minutes()
  const end = occupiedEnd(subject.pickupAt, subject.landingAt, minutes.transferDurationMinutes)
  const windows = await ports.windows({
    driverIds: [],
    vehicleIds: [],
    partnerIds: [subject.partnerId],
    from: subject.pickupAt,
    to: end,
  })
  const unavailable = partnerUnavailable(subject, windows, minutes.transferDurationMinutes)
  return unavailable.length > 0
    ? { overlaps: [], tightGaps: [], unavailable }
    : { overlaps: [], tightGaps: [] }
}
