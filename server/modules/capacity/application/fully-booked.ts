import type { OccupyingRide } from '../domain/occupation'
import type { UnavailabilityWindow } from '../domain/unavailability'
import type { ActiveFleet, CapacityPorts } from './ports'
import { occupiedEnd } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { windowIsFullyBooked } from '../domain/fully-booked'

/** One unfinished unassigned Ride the board may mark Popunjeno. */
export interface BoardFullyBookedRide {
  readonly rideId: string
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

export interface FullyBookedSubject {
  readonly rideId: string
  readonly pickupAt: Date
  readonly landingAt: Date | null
  readonly durationMinutes: number
  readonly chosen?: { readonly driverId: string, readonly vehicleId: string }
}

/**
 * Whether this window is fully booked (ADR-0034). The Ride in `leaveOut`
 * occupies nothing. A chosen pair that is free makes the answer false
 * before the rest of the fleet is read. Occupation is the whole Tenant,
 * widened by the transfer duration so a Ride that started earlier and has
 * no landing is still seen. One session client, so the reads are serial.
 */
export async function readFullyBooked(
  ports: CapacityPorts,
  fleet: ActiveFleet,
  subject: FullyBookedSubject,
): Promise<boolean> {
  const driverIds = await fleet.driverIds()
  const vehicleIds = await fleet.vehicleIds()
  const partnerIds = await fleet.partnerIds()
  const end = occupiedEnd(subject.pickupAt, subject.landingAt, subject.durationMinutes)
  const pairPossible = driverIds.length > 0 && vehicleIds.length > 0
  if (!pairPossible && partnerIds.length === 0)
    return true

  const occupying = pairPossible
    ? await ports.occupation.ridesDuring({
        of: 'tenant',
        from: new Date(subject.pickupAt.getTime() - subject.durationMinutes * 60_000),
        to: end,
        leaveOut: subject.rideId,
      })
    : []
  const windows = await ports.windows({
    driverIds,
    vehicleIds,
    partnerIds,
    from: subject.pickupAt,
    to: end,
  })
  return windowIsFullyBooked({
    from: subject.pickupAt,
    to: end,
    durationMinutes: subject.durationMinutes,
    activeDriverIds: driverIds,
    activeVehicleIds: vehicleIds,
    activePartnerIds: partnerIds,
    occupying,
    windows,
    leaveOutRideId: subject.rideId,
    chosen: subject.chosen,
  })
}

/**
 * Popunjeno on the board, derived on read (ADR-0034). One fleet read and
 * one occupation read for the whole list. An unassigned Ride occupies
 * nothing. Office only. Nothing is written.
 */
export async function readBoardFullyBooked(
  ports: CapacityPorts,
  fleet: ActiveFleet,
  role: string,
  input: { readonly rides: readonly BoardFullyBookedRide[], readonly durationMinutes: number },
): Promise<ReadonlySet<string>> {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
  const booked = new Set<string>()
  if (input.rides.length === 0)
    return booked

  const driverIds = await fleet.driverIds()
  const vehicleIds = await fleet.vehicleIds()
  const partnerIds = await fleet.partnerIds()
  const pairPossible = driverIds.length > 0 && vehicleIds.length > 0
  if (!pairPossible && partnerIds.length === 0)
    return new Set(input.rides.map(ride => ride.rideId))

  const duration = input.durationMinutes
  const start = Math.min(...input.rides.map(ride => ride.pickupAt.getTime()))
  const end = Math.max(...input.rides.map(ride => occupiedEnd(ride.pickupAt, ride.landingAt, duration).getTime()))
  const occupying: readonly OccupyingRide[] = pairPossible
    ? await ports.occupation.ridesDuring({
        of: 'tenant',
        from: new Date(start - duration * 60_000),
        to: new Date(end),
      })
    : []
  const windows: readonly UnavailabilityWindow[] = await ports.windows({
    driverIds,
    vehicleIds,
    partnerIds,
    from: new Date(start),
    to: new Date(end),
  })
  for (const ride of input.rides) {
    const rideEnd = occupiedEnd(ride.pickupAt, ride.landingAt, duration)
    if (windowIsFullyBooked({
      from: ride.pickupAt,
      to: rideEnd,
      durationMinutes: duration,
      activeDriverIds: driverIds,
      activeVehicleIds: vehicleIds,
      activePartnerIds: partnerIds,
      occupying,
      windows,
      leaveOutRideId: ride.rideId,
    })) {
      booked.add(ride.rideId)
    }
  }
  return booked
}
