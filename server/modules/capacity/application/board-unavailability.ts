import type { UnavailableResource } from '../../../../shared'
import type { UnavailabilityReader } from './ports'
import { occupiedEnd } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { partnerUnavailable, unavailableResources } from '../domain/unavailability'

/** One Ride on the board that can carry an unavailability warning. */
export interface BoardUnavailabilityRide {
  readonly rideId: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/**
 * The board's unavailability warning (ADR-0034), derived on read: for each
 * listed Ride a live window covers. An assigned or accepted Ride names its
 * Driver and Vehicle. A handed-off Ride names its Partner. A Ride that is
 * not covered is not in the map. One read for the whole list. Display only:
 * nothing is written. Office only, like the board.
 */
export async function readBoardUnavailability(
  windows: UnavailabilityReader,
  role: string,
  input: { readonly rides: readonly BoardUnavailabilityRide[], readonly durationMinutes: number },
): Promise<Map<string, UnavailableResource[]>> {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
  const held = input.rides.filter(ride =>
    (ride.driverId !== null && ride.vehicleId !== null) || ride.partnerId !== null,
  )
  const unavailable = new Map<string, UnavailableResource[]>()
  if (held.length === 0)
    return unavailable

  const ends = held.map(ride => occupiedEnd(ride.pickupAt, ride.landingAt, input.durationMinutes).getTime())
  const covering = await windows({
    driverIds: [...new Set(held.flatMap(ride => ride.driverId === null ? [] : [ride.driverId]))],
    vehicleIds: [...new Set(held.flatMap(ride => ride.vehicleId === null ? [] : [ride.vehicleId]))],
    partnerIds: [...new Set(held.flatMap(ride => ride.partnerId === null ? [] : [ride.partnerId]))],
    from: new Date(Math.min(...held.map(ride => ride.pickupAt.getTime()))),
    to: new Date(Math.max(...ends, ...held.map(ride => ride.pickupAt.getTime()))),
  })
  for (const ride of held) {
    const resources = ride.driverId !== null && ride.vehicleId !== null
      ? unavailableResources(
          { driverId: ride.driverId, vehicleId: ride.vehicleId, pickupAt: ride.pickupAt, landingAt: ride.landingAt },
          covering,
          input.durationMinutes,
        )
      : ride.partnerId === null
        ? []
        : partnerUnavailable(
            { partnerId: ride.partnerId, pickupAt: ride.pickupAt, landingAt: ride.landingAt },
            covering,
            input.durationMinutes,
          )
    if (resources.length > 0)
      unavailable.set(ride.rideId, resources)
  }
  return unavailable
}
