import type { DisplayLocale, RideExportRide } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { buildRideExportCsv, calendarDayBounds, locationLabel, parseRideExportQuery, paymentMethodSchema, resolveDisplayLocale, rideExportFilename, rideStateSchema } from '../../../../shared'
import { getLogger, hideDatabaseError } from '../../../core/index'
import { loadClients } from '../../clients'
import { loadDrivers } from '../../drivers'
import { loadLocations } from '../../locations'
import { loadTenantDefaultLocale, loadTenantSettings, readUserLocale, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadVehicles } from '../../vehicles'
import { toInstant, toPrice } from './transfers'

function officeOnly(role: string): void {
  // A spreadsheet of every Ride is office work. A driver is refused
  // before a Ride is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

const exportRowSchema = z.object({
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  clientId: z.uuid(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
})

/**
 * Every Ride whose pickup falls on these calendar days, every state,
 * pickup order. The guest name is not selected. Names come from the
 * catalog modules on this transaction (ADR-0018), including an archived
 * Driver, Vehicle, or Location still named by a Ride.
 */
async function loadRideExport(
  transaction: TenantTransaction,
  from: string,
  to: string,
  timeZone: string,
): Promise<RideExportRide[]> {
  const bounds = calendarDayBounds(from, to, timeZone)
  const selected = z.object({ rows: z.array(exportRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.state,
        r.driver_id as "driverId",
        r.vehicle_id as "vehicleId",
        t.client_id as "clientId",
        t.pickup_at as "pickupAt",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        t.price,
        t.payment
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where t.pickup_at >= ${bounds.start.toISOString()}
        and t.pickup_at < ${bounds.end.toISOString()}
      order by t.pickup_at, r.id
    `),
    'Ride export failed',
  ))
  const clients = new Map((await loadClients(transaction)).map(client => [client.id, client.name]))
  const places = new Map((await loadLocations(transaction, true)).map(place => [place.id, locationLabel(place)]))
  const drivers = new Map((await loadDrivers(transaction, true)).map(driver => [driver.id, driver.name]))
  const vehicles = new Map((await loadVehicles(transaction, true)).map(vehicle => [vehicle.id, vehicle.registrationPlate]))
  return selected.rows.map((row) => {
    const pickup = places.get(row.startLocationId)
    const dropOff = places.get(row.endLocationId)
    const client = clients.get(row.clientId)
    const driver = row.driverId === null ? '' : drivers.get(row.driverId)
    const plate = row.vehicleId === null ? '' : vehicles.get(row.vehicleId)
    if (pickup === undefined || dropOff === undefined || client === undefined || driver === undefined || plate === undefined)
      throw new Error('Ride export failed')
    return {
      pickupAt: toInstant(row.pickupAt),
      pickup,
      dropOff,
      client,
      driver,
      plate,
      price: toPrice(row.price),
      payment: row.payment,
      state: row.state,
    }
  })
}

async function displayLocale(transaction: TenantTransaction, userId: string): Promise<DisplayLocale> {
  // A null user locale follows the Tenant default (ADR-0011).
  // That default is the tenancy module's read.
  return resolveDisplayLocale(
    await readUserLocale(userId),
    await loadTenantDefaultLocale(transaction),
  )
}

/**
 * The office CSV for one calendar range. The query is parsed first, so a
 * bad range never opens a session. A driver is 403. No session is 401.
 * Another Tenant cannot: the tables have FORCE RLS. Nothing is written.
 * One log line names the member, the range, and how many rows. `log` is
 * the process logger when the route omits it.
 */
export async function exportRides(
  headers: Headers,
  raw: unknown,
  log?: Logger,
): Promise<{ filename: string, body: string }> {
  const range = parseRideExportQuery(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const settings = await loadTenantSettings(transaction)
    const locale = await displayLocale(transaction, actor.userId)
    const rides = await loadRideExport(transaction, range.from, range.to, settings.timeZone)
    const body = buildRideExportCsv(rides, settings.timeZone, locale)
    ;(log ?? getLogger()).info({
      event: 'rides.exported',
      userId: actor.userId,
      from: range.from,
      to: range.to,
      rowCount: rides.length,
    }, 'rides exported')
    return { filename: rideExportFilename(range.from, range.to), body }
  })
}
