import type { ClientKind, DriverUpcomingList, DriverUpcomingRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { presentDriverRide } from '../../../../shared'
import { loadClient } from '../../clients'
import { loadDriverLinkedToMember } from '../../drivers'
import { loadLocation } from '../../locations'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadVehicle } from '../../vehicles'
import { loadUpcomingRidesForDriver } from './driver-rides'

function driverOnly(role: string): void {
  // The phone list is the Driver's. The office keeps the day list, which
  // still shows every price. A dispatcher or an admin is refused here.
  if (role === 'driver')
    return
  throw new TenantAccessError(403)
}

interface LocationLine {
  readonly name: string
  readonly address: string | null
}

interface ClientLine {
  readonly name: string
  readonly kind: ClientKind
}

/**
 * One Location, by id. An archived Location still has its name and address
 * (ADR-0018: a Transfer points at a Location, it does not list the catalog).
 * The address stays null when the Location has none.
 */
async function locationLine(transaction: TenantTransaction, locationId: string, locations: Map<string, LocationLine>): Promise<LocationLine> {
  const known = locations.get(locationId)
  if (known)
    return known
  const location = await loadLocation(transaction, locationId)
  const line: LocationLine = { name: location.name, address: location.address }
  locations.set(locationId, line)
  return line
}

/**
 * One Client, by id. An external Driver sees the same name and kind the
 * office recorded. The id itself is not put on the phone.
 */
async function clientLine(transaction: TenantTransaction, clientId: string, clients: Map<string, ClientLine>): Promise<ClientLine> {
  const known = clients.get(clientId)
  if (known)
    return known
  const client = await loadClient(transaction, clientId)
  const line: ClientLine = { name: client.name, kind: client.kind }
  clients.set(clientId, line)
  return line
}

/**
 * The plate, by id, including after the Vehicle is archived. There is no
 * archived mark: the card shows the plate the Ride was given.
 */
async function plateOf(transaction: TenantTransaction, vehicleId: string, plates: Map<string, string>): Promise<string> {
  const known = plates.get(vehicleId)
  if (known)
    return known
  const vehicle = await loadVehicle(transaction, vehicleId)
  plates.set(vehicleId, vehicle.registrationPlate)
  return vehicle.registrationPlate
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
      const locations = new Map<string, LocationLine>()
      const clients = new Map<string, ClientLine>()
      const plates = new Map<string, string>()
      const rides: DriverUpcomingRide[] = []
      for (const row of rows) {
        const from = await locationLine(transaction, row.startLocationId, locations)
        const to = await locationLine(transaction, row.endLocationId, locations)
        const client = await clientLine(transaction, row.clientId, clients)
        rides.push(presentDriverRide({
          rideId: row.rideId,
          pickupAt: row.pickupAt,
          guestName: row.guestName,
          from: from.name,
          to: to.name,
          passengerCount: row.passengerCount,
          flightNumber: row.flightNumber,
          airportMark: row.airportMark,
          clientName: client.name,
          clientKind: client.kind,
          fromAddress: from.address,
          toAddress: to.address,
          luggageCount: row.luggageCount,
          childSeatCount: row.childSeatCount,
          note: row.note,
          tabla: row.tabla,
          registrationPlate: await plateOf(transaction, row.vehicleId, plates),
          price: row.price,
          payment: row.payment,
          state: row.state,
          mustAccept: row.mustAccept,
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
