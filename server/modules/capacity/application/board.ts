import type { ScheduleRide } from '../../../../shared'
import type { OccupationPort } from './ports'
import { localDayBounds } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { boardOccupationRange } from '../domain/board-range'
import { toScheduleRide } from '../domain/occupation'

/** One Ride on the board that occupies its Driver and Vehicle. */
export interface BoardOccupyingRide {
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/**
 * The occupation behind the board's overlap warning (ADR-0034): every
 * assigned or accepted Ride of the listed Drivers and Vehicles whose window
 * can touch this operational day. A neighbour on another day is included,
 * so a clash across midnight is still named. Display only: nothing is
 * written. Office only, like the board it serves.
 */
export async function readBoardOccupation(
  occupation: OccupationPort,
  role: string,
  input: {
    readonly day: string
    readonly timeZone: string
    readonly startHour: number
    readonly rides: readonly BoardOccupyingRide[]
  },
): Promise<ScheduleRide[]> {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
  const driverIds = idsOf(input.rides.map(ride => ride.driverId))
  const vehicleIds = idsOf(input.rides.map(ride => ride.vehicleId))
  if (driverIds.length === 0 && vehicleIds.length === 0)
    return []
  const range = boardOccupationRange(localDayBounds(input.day, input.timeZone, input.startHour), input.rides)
  const occupying = await occupation.ridesDuring({
    of: { driverIds, vehicleIds, partnerIds: [] },
    from: range.from,
    to: range.to,
  })
  return occupying.map(toScheduleRide)
}

function idsOf(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((id): id is string => id !== null))]
}
