import type { ScheduleRide } from '../../../../shared'
import type { CapacityVerdict } from '../domain/occupation'
import type { CapacityPorts } from './ports'
import { occupiedEnd } from '../../../../shared'
import { judgeOccupation } from '../domain/occupation'
import { unavailableResources } from '../domain/unavailability'

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
    from: subject.pickupAt,
    to: occupiedEnd(subject.pickupAt, subject.landingAt, minutes.transferDurationMinutes),
  })
  const verdict = judgeOccupation(subject, occupying, minutes)
  const unavailable = unavailableResources(subject, windows, minutes.transferDurationMinutes)
  return unavailable.length > 0 ? { ...verdict, unavailable } : verdict
}
