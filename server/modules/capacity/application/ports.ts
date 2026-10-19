import type { CapacityMinutes, OccupyingRide } from '../domain/occupation'

export type { CapacityMinutes, OccupyingRide } from '../domain/occupation'

/**
 * The Rides that occupy one Driver or one Vehicle, at any time. `rideId`
 * is the Ride being judged and is left out of the answer. A command asks
 * this for the Driver and the Vehicle it is about to write.
 */
export interface RideOccupationQuery {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
}

/** Whose Rides a range question asks about. No Ride has a Partner yet, so `partnerIds` match nothing. */
export interface OccupationResources {
  readonly driverIds: readonly string[]
  readonly vehicleIds: readonly string[]
  readonly partnerIds: readonly string[]
}

/**
 * The Rides of these resources, or of the whole Tenant, that touch the
 * half-open range `[from, to)`: the pickup or the landing falls inside it,
 * or the pickup is before it and the landing at or after its end.
 * `leaveOut` is a Ride that is never in the answer.
 */
export interface RangeOccupationQuery {
  readonly of: OccupationResources | 'tenant'
  readonly from: Date
  readonly to: Date
  readonly leaveOut?: string
}

/**
 * Who is taken (ADR-0034, ADR-0036). Capacity defines it; the transfers
 * infrastructure implements it, so capacity never reads a Ride table.
 * Both answers hold assigned and accepted Rides only.
 */
export interface OccupationPort {
  ridesOf: (query: RideOccupationQuery) => Promise<readonly OccupyingRide[]>
  ridesDuring: (query: RangeOccupationQuery) => Promise<readonly OccupyingRide[]>
}

/** Reads the Tenant's transfer duration and relocation gap from tenancy. */
export type CapacityMinutesReader = () => Promise<CapacityMinutes>

/** Everything a capacity application service reads through. */
export interface CapacityPorts {
  readonly occupation: OccupationPort
  readonly minutes: CapacityMinutesReader
}
