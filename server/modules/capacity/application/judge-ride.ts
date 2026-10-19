import type { ScheduleRide } from '../../../../shared'
import type { CapacityVerdict } from '../domain/occupation'
import type { CapacityPorts } from './ports'
import { judgeOccupation } from '../domain/occupation'

/**
 * The one capacity check for a command that writes a Driver and a Vehicle
 * onto a Ride: assign, a Vehicle change, a reassignment, and a judged
 * Transfer correction (ADR-0029, ADR-0034). `subject` is the Ride with the
 * Driver and the Vehicle it is about to hold, at its stored times.
 *
 * The caller holds the Tenant capacity lock, so the occupation it reads is
 * every other capacity write of this Tenant that has committed. The verdict
 * refuses nothing; the caller throws `RideOverlapError` unless confirmed.
 */
export async function judgeRideCapacity(ports: CapacityPorts, subject: ScheduleRide): Promise<CapacityVerdict> {
  const minutes = await ports.minutes()
  const occupying = await ports.occupation.ridesOf({
    rideId: subject.rideId,
    driverId: subject.driverId,
    vehicleId: subject.vehicleId,
  })
  return judgeOccupation(subject, occupying, minutes)
}
