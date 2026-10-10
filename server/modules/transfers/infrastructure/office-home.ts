import type { OfficeHome, OfficeHomeRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { buildOfficeHome, localDayBounds, operationalDateInTimeZone, paymentMethodSchema, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadDrivers } from '../../drivers'
import { loadLocations } from '../../locations'
import { loadTenantSettings } from '../../tenancy'
import { loadVehicles } from '../../vehicles'
import { toInstant, toPrice } from './transfers'

const sourceRowSchema = z.object({
  rideId: z.uuid(),
  pickupAt: z.unknown(),
  guestName: z.string(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
  flightNumber: z.string().nullable(),
})

/**
 * Rides the snapshot can list or count, in one query so the lists and the
 * counts are the same moment. A Ride outside this filter is on no list and
 * not on the operational day, so leaving it out does not change the result.
 * Names are resolved afterwards, through each catalog module, on this same
 * transaction (ADR-0018).
 */
export async function loadOfficeHome(transaction: TenantTransaction, now: Date): Promise<OfficeHome> {
  const settings = await loadTenantSettings(transaction)
  const timeZone = settings.timeZone
  const bounds = localDayBounds(operationalDateInTimeZone(timeZone, now), timeZone)
  const nowIso = now.toISOString()
  const selected = z.object({ rows: z.array(sourceRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.pickup_at as "pickupAt",
        t.guest_name as "guestName",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        r.state,
        r.driver_id as "driverId",
        r.vehicle_id as "vehicleId",
        r.must_accept as "mustAccept",
        t.price,
        t.payment,
        t.flight_number as "flightNumber"
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where
        (t.pickup_at >= ${bounds.start.toISOString()} and t.pickup_at < ${bounds.end.toISOString()})
        or r.state = 'unassigned'
        or (r.state = 'assigned' and r.must_accept is true)
        or (
          t.pickup_at < ${nowIso}
          and r.driver_id is not null
          and r.state not in ('done', 'no-show', 'cancelled', 'unassigned')
          and not (r.state = 'assigned' and r.must_accept is true)
        )
    `),
    'Office home read failed',
  ))

  const places = new Map((await loadLocations(transaction, true)).map(place => [place.id, place.name]))
  const drivers = new Map((await loadDrivers(transaction)).map(driver => [driver.id, driver.name]))
  const vehicles = new Map((await loadVehicles(transaction, true)).map(vehicle => [vehicle.id, vehicle.registrationPlate]))

  const rides: OfficeHomeRide[] = selected.rows.map((row) => {
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    if (start === undefined || end === undefined)
      throw new Error('Office home read failed')
    return {
      rideId: row.rideId,
      pickupAt: toInstant(row.pickupAt),
      guestName: row.guestName,
      start,
      end,
      state: row.state,
      driverId: row.driverId,
      driverName: named(row.driverId, drivers),
      vehiclePlate: named(row.vehicleId, vehicles),
      price: toPrice(row.price),
      payment: row.payment,
      flightNumber: row.flightNumber,
      mustAccept: row.mustAccept,
    }
  })

  return buildOfficeHome(rides, now, timeZone)
}

/** A missing Driver or Vehicle for an id that is set fails the whole read. A null id is an empty name. */
function named(id: string | null, names: Map<string, string>): string | null {
  if (id === null)
    return null
  const name = names.get(id)
  if (name === undefined)
    throw new Error('Office home read failed')
  return name
}
