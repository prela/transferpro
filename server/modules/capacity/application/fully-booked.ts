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
 * occupies nothing. Occupation is the whole Tenant, widened by the
 * transfer duration so a Ride that started earlier and has no landing is
 * still seen. A free chosen pair makes the answer false. The caller skips
 * this read when that pair is already free.
 */
export async function readFullyBooked(
  ports: CapacityPorts,
  fleet: ActiveFleet,
  subject: FullyBookedSubject,
): Promise<boolean> {
  const end = occupiedEnd(subject.pickupAt, subject.landingAt, subject.durationMinutes)
  const fleetRead = await readFleetSpan(ports, fleet, {
    from: subject.pickupAt,
    to: end,
    durationMinutes: subject.durationMinutes,
    leaveOut: subject.rideId,
  })
  if (fleetRead === null)
    return true
  return windowIsFullyBooked({
    from: subject.pickupAt,
    to: end,
    durationMinutes: subject.durationMinutes,
    activeDriverIds: fleetRead.driverIds,
    activeVehicleIds: fleetRead.vehicleIds,
    activePartnerIds: fleetRead.partnerIds,
    occupying: fleetRead.occupying,
    windows: fleetRead.windows,
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

  const duration = input.durationMinutes
  const start = Math.min(...input.rides.map(ride => ride.pickupAt.getTime()))
  const end = Math.max(...input.rides.map(ride => occupiedEnd(ride.pickupAt, ride.landingAt, duration).getTime()))
  const fleetRead = await readFleetSpan(ports, fleet, {
    from: new Date(start),
    to: new Date(end),
    durationMinutes: duration,
  })
  if (fleetRead === null)
    return new Set(input.rides.map(ride => ride.rideId))

  for (const ride of input.rides) {
    const rideEnd = occupiedEnd(ride.pickupAt, ride.landingAt, duration)
    if (windowIsFullyBooked({
      from: ride.pickupAt,
      to: rideEnd,
      durationMinutes: duration,
      activeDriverIds: fleetRead.driverIds,
      activeVehicleIds: fleetRead.vehicleIds,
      activePartnerIds: fleetRead.partnerIds,
      occupying: fleetRead.occupying,
      windows: fleetRead.windows,
      leaveOutRideId: ride.rideId,
    })) {
      booked.add(ride.rideId)
    }
  }
  return booked
}

/**
 * The span both fully-booked callers ask about. `to` is the occupied end.
 * `leaveOut` is the one Ride a command is judging. The board omits it and
 * leaves each Ride out when it judges that Ride.
 */
interface FleetSpan {
  readonly from: Date
  readonly to: Date
  readonly durationMinutes: number
  readonly leaveOut?: string
}

/** Active ids, occupying Rides, and unavailability windows for one span. */
interface FleetSpanRead {
  readonly driverIds: readonly string[]
  readonly vehicleIds: readonly string[]
  readonly partnerIds: readonly string[]
  readonly occupying: readonly OccupyingRide[]
  readonly windows: readonly UnavailabilityWindow[]
}

/**
 * Fleet, occupation, and windows for one span (ADR-0034). Both fully-booked
 * callers use this. The three fleet reads stay serial: one session client
 * cannot run them together. Null means no active pair and no active
 * Partner, so the span is booked and occupation is not read. When a pair
 * is impossible the occupation stays empty; a Partner may still be free.
 */
async function readFleetSpan(
  ports: CapacityPorts,
  fleet: ActiveFleet,
  span: FleetSpan,
): Promise<FleetSpanRead | null> {
  const driverIds = await fleet.driverIds()
  const vehicleIds = await fleet.vehicleIds()
  const partnerIds = await fleet.partnerIds()
  const pairPossible = driverIds.length > 0 && vehicleIds.length > 0
  if (!pairPossible && partnerIds.length === 0)
    return null

  const occupying = pairPossible
    ? await ports.occupation.ridesDuring({
        of: 'tenant',
        from: new Date(span.from.getTime() - span.durationMinutes * 60_000),
        to: span.to,
        ...(span.leaveOut === undefined ? {} : { leaveOut: span.leaveOut }),
      })
    : []
  const windows = await ports.windows({
    driverIds,
    vehicleIds,
    partnerIds,
    from: span.from,
    to: span.to,
  })
  return { driverIds, vehicleIds, partnerIds, occupying, windows }
}
