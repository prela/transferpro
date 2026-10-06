import type { Ride, RosterVehicleSuggestion } from '../../../../shared'
import { parseAssignRide, parseRosterVehicleRead } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { assignUnassignedRide, suggestRosterVehicle } from './assign'

function officeOnly(role: string): void {
  // Assigning a Ride is office work. A driver does none of it (ADR-0005).
  // The check runs before a Ride, a Driver, or a Vehicle is loaded.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * Assign a Driver and a Vehicle together. The body is parsed first, so a
 * Driver without a Vehicle never opens a session. A driver is 403. The
 * update and `ride.assigned` commit together.
 */
export async function assignRide(headers: Headers, raw: unknown): Promise<Ride> {
  const input = parseAssignRide(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return assignUnassignedRide(transaction, actor.userId, input)
  })
}

/**
 * The roster Vehicle for this Ride and Driver. The ids are parsed first.
 * A driver is 403. The read writes nothing, including when the suggestion is none.
 */
export async function rosterVehicleForRide(headers: Headers, rawRideId: unknown, rawDriverId: unknown): Promise<RosterVehicleSuggestion> {
  const input = parseRosterVehicleRead(rawRideId, rawDriverId)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return suggestRosterVehicle(transaction, input.rideId, input.driverId)
  })
}
