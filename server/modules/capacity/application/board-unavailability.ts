import type { ScheduleResource } from '../../../../shared'
import type { UnavailabilityReader } from './ports'
import { occupiedEnd } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { unavailableResources } from '../domain/unavailability'

/** One assigned or accepted Ride on the board. */
export interface BoardUnavailabilityRide {
  readonly rideId: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/**
 * The board's unavailability warning (ADR-0034), derived on read: for each
 * listed Ride whose Driver or Vehicle a live window covers, which of the two
 * it covers. A Ride that is not covered is not in the map. One read for the
 * whole list. Display only: nothing is written. Office only, like the board.
 */
export async function readBoardUnavailability(
  windows: UnavailabilityReader,
  role: string,
  input: { readonly rides: readonly BoardUnavailabilityRide[], readonly durationMinutes: number },
): Promise<Map<string, ScheduleResource[]>> {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
  const held = input.rides.flatMap(ride => ride.driverId !== null && ride.vehicleId !== null
    ? [{ ...ride, driverId: ride.driverId, vehicleId: ride.vehicleId }]
    : [])
  const unavailable = new Map<string, ScheduleResource[]>()
  if (held.length === 0)
    return unavailable

  const ends = held.map(ride => occupiedEnd(ride.pickupAt, ride.landingAt, input.durationMinutes).getTime())
  const covering = await windows({
    driverIds: [...new Set(held.map(ride => ride.driverId))],
    vehicleIds: [...new Set(held.map(ride => ride.vehicleId))],
    from: new Date(Math.min(...held.map(ride => ride.pickupAt.getTime()))),
    to: new Date(Math.max(...ends, ...held.map(ride => ride.pickupAt.getTime()))),
  })
  for (const ride of held) {
    const resources = unavailableResources(ride, covering, input.durationMinutes)
    if (resources.length > 0)
      unavailable.set(ride.rideId, resources)
  }
  return unavailable
}
