import type { ScheduleClash, ScheduleRide, UnavailableResource } from '../../../../shared'
import type { CapacityVerdict } from '../domain/occupation'
import type { ActiveFleet, CapacityPorts } from './ports'
import { occupiedEnd } from '../../../../shared'
import { judgeOccupation } from '../domain/occupation'
import { partnerUnavailable, unavailableResources } from '../domain/unavailability'
import { readFullyBooked } from './fully-booked'

const noFleet: ActiveFleet = {
  driverIds: async () => [],
  vehicleIds: async () => [],
  partnerIds: async () => [],
}

/**
 * The one capacity check for a command that writes a Driver and a Vehicle
 * onto a Ride: assign, a Vehicle change, a reassignment, and a judged
 * Transfer correction (ADR-0029, ADR-0034). `subject` is the Ride with the
 * Driver and the Vehicle it is about to hold, at its stored times.
 *
 * The caller holds the Tenant capacity lock, so the occupation and the
 * windows it reads are every other capacity write of this Tenant that has
 * committed. The verdict refuses nothing; the caller throws
 * `FullyBookedError` before `RideUnavailableError` or `RideOverlapError`.
 * Confirming passes the last two and does not pass a fully booked window.
 * `unavailable` is there only when a window covers the occupied window.
 * A chosen pair that is free is not fully booked, and the fleet is not read.
 */
export async function judgeRideCapacity(
  ports: CapacityPorts,
  subject: ScheduleRide,
  fleet: ActiveFleet = noFleet,
): Promise<CapacityVerdict> {
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
  const partial = unavailable.length > 0 ? { ...verdict, unavailable } : verdict
  if (chosenPairFree(verdict.overlaps, unavailable))
    return { ...partial, fullyBooked: false }
  const fullyBooked = await readFullyBooked(ports, fleet, {
    rideId: subject.rideId,
    pickupAt: subject.pickupAt,
    landingAt: subject.landingAt,
    durationMinutes: minutes.transferDurationMinutes,
    chosen: { driverId: subject.driverId, vehicleId: subject.vehicleId },
  })
  return { ...partial, fullyBooked }
}

/**
 * The capacity check for handing a Ride to a Partner, or changing the
 * Partner (ADR-0034, ADR-0048). A window over that Partner is
 * `unavailable: ['partner']`. A Ride already handed to the Partner does
 * not occupy them, so the verdict has no overlap and no tight gap.
 * The caller holds the Tenant capacity lock. The verdict refuses nothing.
 * A free Partner is not a fully booked window, and the fleet is not read.
 */
export async function judgePartnerCapacity(
  ports: CapacityPorts,
  subject: { readonly rideId: string, readonly partnerId: string, readonly pickupAt: Date, readonly landingAt: Date | null },
  fleet: ActiveFleet = noFleet,
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
  if (unavailable.length === 0)
    return { overlaps: [], tightGaps: [], fullyBooked: false }
  // The Ride being handed off is left out, so the pair it releases is free.
  const fullyBooked = await readFullyBooked(ports, fleet, {
    rideId: subject.rideId,
    pickupAt: subject.pickupAt,
    landingAt: subject.landingAt,
    durationMinutes: minutes.transferDurationMinutes,
  })
  return { overlaps: [], tightGaps: [], unavailable, fullyBooked }
}

/**
 * The Driver and the Vehicle the command is about to write are both free:
 * no true overlap and no window. A tight gap still counts as free.
 */
function chosenPairFree(
  overlaps: readonly ScheduleClash[],
  unavailable: readonly UnavailableResource[] | undefined,
): boolean {
  const covered = unavailable ?? []
  return !overlaps.some(clash => clash.resource === 'driver')
    && !overlaps.some(clash => clash.resource === 'vehicle')
    && !covered.includes('driver')
    && !covered.includes('vehicle')
}
