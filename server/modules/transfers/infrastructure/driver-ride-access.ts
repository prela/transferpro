import type { DriverUpcomingList, DriverUpcomingRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { presentDriverRide } from '../../../../shared'
import { loadDriverLinkedToMember } from '../../drivers'
import { loadLocation } from '../../locations'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadUpcomingRidesForDriver } from './driver-rides'

function driverOnly(role: string): void {
  // The phone list is the Driver's. The office keeps the day list, which
  // still shows every price. A dispatcher or an admin is refused here.
  if (role === 'driver')
    return
  throw new TenantAccessError(403)
}

/**
 * One place, by id. An archived Location still has a name (ADR-0018:
 * Transfers reference a Location by id, they do not list the catalog).
 */
async function placeName(transaction: TenantTransaction, locationId: string, names: Map<string, string>): Promise<string> {
  const known = names.get(locationId)
  if (known)
    return known
  const place = await loadLocation(transaction, locationId)
  names.set(locationId, place.name)
  return place.name
}

/**
 * Upcoming Rides for the signed-in Driver.
 * The Driver id is the row linked to this member, read inside the tenant
 * transaction. A query string cannot choose a Driver. A member with no
 * linked Driver gets an empty list, not an error.
 */
export async function listUpcomingRides(headers: Headers): Promise<DriverUpcomingList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    driverOnly(actor.role)
    try {
      const linked = await loadDriverLinkedToMember(transaction, actor.userId)
      // One member, one Driver. The partial unique index is that rule.
      const driverId = linked[0]?.id
      if (!driverId)
        return { rides: [] }
      const rows = await loadUpcomingRidesForDriver(transaction, driverId)
      const names = new Map<string, string>()
      const rides: DriverUpcomingRide[] = []
      for (const row of rows) {
        rides.push(presentDriverRide({
          rideId: row.rideId,
          pickupAt: row.pickupAt,
          guestName: row.guestName,
          from: await placeName(transaction, row.startLocationId, names),
          to: await placeName(transaction, row.endLocationId, names),
          passengerCount: row.passengerCount,
          flightNumber: row.flightNumber,
          airportMark: row.airportMark,
          price: row.price,
          payment: row.payment,
        }))
      }
      return { rides }
    }
    catch (error) {
      // A Zod failure repeats the guest name, the phone, or the place.
      // The logger does not scan Error.message, so the text stays fixed.
      if (error instanceof Error && error.message === 'Driver ride read failed')
        throw error
      throw new Error('Driver ride read failed')
    }
  })
}
