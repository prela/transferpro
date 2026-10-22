import type { OccupyingRide } from './occupation'
import type { UnavailabilityWindow } from './unavailability'
import { intervalsOverlap, occupiedEnd } from '../../../../shared'
import { coversSpan } from './unavailability'

/**
 * Facts for one window (ADR-0034). `to` is the occupied end. The roster is
 * not an input: any active Driver may pair with any active Vehicle.
 * `leaveOutRideId` is the Ride being changed, so it occupies nothing.
 * A chosen pair is the Driver and Vehicle a command is about to write.
 * The caller has already refused an archived one.
 */
export interface FullyBookedFacts {
  readonly from: Date
  readonly to: Date
  readonly durationMinutes: number
  readonly activeDriverIds: readonly string[]
  readonly activeVehicleIds: readonly string[]
  readonly activePartnerIds: readonly string[]
  readonly occupying: readonly OccupyingRide[]
  readonly windows: readonly UnavailabilityWindow[]
  readonly leaveOutRideId: string
  readonly chosen?: { readonly driverId: string, readonly vehicleId: string }
}

/**
 * No free Driver with a free Vehicle, and no free Partner (ADR-0034).
 * A Partner is free when no window covers the span. A handed-off Ride
 * does not take a Partner. A tight relocation gap does not take a Driver
 * or a Vehicle: only a true overlap does. A chosen pair that is itself
 * free is never fully booked, even when the rest of the fleet is taken.
 */
export function windowIsFullyBooked(facts: FullyBookedFacts): boolean {
  if (facts.chosen && pairFree(facts.chosen.driverId, facts.chosen.vehicleId, facts))
    return false
  const driverFree = facts.activeDriverIds.some(driverId => !driverTaken(driverId, facts))
  const vehicleFree = facts.activeVehicleIds.some(vehicleId => !vehicleTaken(vehicleId, facts))
  if (driverFree && vehicleFree)
    return false
  return !facts.activePartnerIds.some(partnerId => !partnerCovered(partnerId, facts))
}

function pairFree(driverId: string, vehicleId: string, facts: FullyBookedFacts): boolean {
  return !driverTaken(driverId, facts) && !vehicleTaken(vehicleId, facts)
}

function driverTaken(driverId: string, facts: FullyBookedFacts): boolean {
  if (facts.windows.some(window => window.driverId === driverId && coversSpan(window, facts.from, facts.to)))
    return true
  return facts.occupying.some(ride =>
    ride.rideId !== facts.leaveOutRideId
    && ride.driverId === driverId
    && windowsOverlap(facts.from, facts.to, ride, facts.durationMinutes),
  )
}

function vehicleTaken(vehicleId: string, facts: FullyBookedFacts): boolean {
  if (facts.windows.some(window => window.vehicleId === vehicleId && coversSpan(window, facts.from, facts.to)))
    return true
  return facts.occupying.some(ride =>
    ride.rideId !== facts.leaveOutRideId
    && ride.vehicleId === vehicleId
    && windowsOverlap(facts.from, facts.to, ride, facts.durationMinutes),
  )
}

function partnerCovered(partnerId: string, facts: FullyBookedFacts): boolean {
  return facts.windows.some(window => window.partnerId === partnerId && coversSpan(window, facts.from, facts.to))
}

/** Half-open occupied windows. The shared judge owns the rule (ADR-0029). */
function windowsOverlap(from: Date, to: Date, ride: OccupyingRide, durationMinutes: number): boolean {
  return intervalsOverlap(from, to, ride.pickupAt, occupiedEnd(ride.pickupAt, ride.landingAt, durationMinutes))
}
