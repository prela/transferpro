import type { OfficeHome, OfficeHomeRide, TenantRole } from '../../../../shared'
import type { TenantContext, TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { buildOfficeHome, localDayBounds, officeHomeBlocks, officeHomeSchema, operationalDateInTimeZone, PASSENGER_COUNT_MAX, PASSENGER_COUNT_MIN, paymentMethodSchema, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadClients } from '../../clients'
import { loadDrivers } from '../../drivers'
import { readInvoiceHomeNotices } from '../../invoicing'
import { loadLocations } from '../../locations'
import { loadTenantSettings } from '../../tenancy'
import { loadVehicles } from '../../vehicles'
import { loadFailedInvitations, loadFailedWorkOrders } from './failed-mail'
import { toInstant, toPrice } from './transfers'

const sourceRowSchema = z.object({
  rideId: z.uuid(),
  pickupAt: z.unknown(),
  guestName: z.string(),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  clientId: z.uuid(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
  flightNumber: z.string().nullable(),
  landingAt: z.unknown().nullish(),
  expectedArrival: z.unknown().nullish(),
  tabla: z.string(),
  // Driver ids, not names. The name is resolved with the other catalog names.
  declinedBy: z.array(z.uuid()),
})

/**
 * Shown when the declining Driver is no longer in the catalog.
 * It is not a person's name, in either locale.
 */
const MISSING_DECLINE_DRIVER = '—'

/**
 * Rides the snapshot can list or count, in one query so the lists and the
 * counts are the same moment. Decline alerts for an unassigned Ride are
 * read in that same statement: assignment does not delete the stored row,
 * and a decline committed later must not appear on this snapshot.
 * A Ride outside this filter is on no list and not on the operational day,
 * so leaving it out does not change the result. A handed-off Ride whose
 * pickup is already past is included even on an earlier day, so the
 * unclosed mark can still surface it (ADR-0048). Names are resolved
 * afterwards, through each catalog module, on this same transaction
 * (ADR-0018).
 * `viewer` is the session's Tenant and role. Failed invitations are listed
 * for an Admin only. Without a viewer, only failed work orders are read.
 */
export async function loadOfficeHome(
  transaction: TenantTransaction,
  now: Date,
  viewer?: { readonly context: TenantContext, readonly role: TenantRole },
): Promise<OfficeHome> {
  const settings = await loadTenantSettings(transaction)
  const timeZone = settings.timeZone
  const startHour = settings.operationalDayStartHour
  const bounds = localDayBounds(operationalDateInTimeZone(timeZone, now, startHour), timeZone, startHour)
  const nowIso = now.toISOString()
  const selected = z.object({ rows: z.array(sourceRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.pickup_at as "pickupAt",
        t.guest_name as "guestName",
        t.passenger_count as "passengerCount",
        t.client_id as "clientId",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        r.state,
        r.driver_id as "driverId",
        r.vehicle_id as "vehicleId",
        r.must_accept as "mustAccept",
        t.price,
        t.payment,
        t.flight_number as "flightNumber",
        t.landing_at as "landingAt",
        t.expected_arrival_at as "expectedArrival",
        t.tabla,
        coalesce((
          select jsonb_agg(a.driver_id order by a.created_at, a.id)
          from app.ride_alert as a
          where a.ride_id = r.id
            and a.tenant_id = r.tenant_id
            and a.kind = 'declined'
            and r.state = 'unassigned'
        ), '[]'::jsonb) as "declinedBy"
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
        or (r.state = 'handed_off' and t.pickup_at < ${nowIso})
    `),
    'Office home read failed',
  ))

  const clients = new Map((await loadClients(transaction)).map(client => [client.id, client.name]))
  const places = new Map((await loadLocations(transaction, true)).map(place => [place.id, place.name]))
  // Archived Drivers stay in the map. A past Ride and a decline alert still name them.
  const drivers = new Map((await loadDrivers(transaction, true)).map(driver => [driver.id, driver.name]))
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
      passengerCount: row.passengerCount,
      clientName: requiredName(row.clientId, clients),
      start,
      end,
      state: row.state,
      driverId: row.driverId,
      driverName: named(row.driverId, drivers),
      vehiclePlate: named(row.vehicleId, vehicles),
      price: toPrice(row.price),
      payment: row.payment,
      flightNumber: row.flightNumber,
      landingAt: row.landingAt == null ? null : toInstant(row.landingAt),
      expectedArrival: row.expectedArrival == null ? null : toInstant(row.expectedArrival),
      tabla: row.tabla,
      mustAccept: row.mustAccept,
      declineAlerts: row.declinedBy.map(driverId => ({ driverName: declineDriverName(driverId, drivers) })),
    }
  })

  const home = buildOfficeHome(rides, now, timeZone, startHour, settings.transferDurationMinutes)
  const notices = await readInvoiceHomeNotices(transaction, now, timeZone)
  const invoiceWarnings = await loadInvoiceWarnings(transaction, notices.warnings, clients, places, drivers, vehicles, home)
  // Derived on read. A finished Ride or a newer work order for this Driver drops the row.
  // Nothing is written, so a refresh cannot turn a failed row into stale by itself.
  const failedWorkOrders = await loadFailedWorkOrders(transaction, drivers, places)
  // Still pending is derived on read. The invitee's email comes from the auth role.
  const failedInvitations = viewer ? await loadFailedInvitations(transaction, viewer.context, viewer.role, now) : []
  return officeHomeSchema.parse({
    ...home,
    failedMails: [...failedWorkOrders, ...failedInvitations],
    invoiceWarnings,
    paymentReportingReminder: notices.paymentReportingReminder,
  })
}

/**
 * Rides for unsent and failed invoices, including a pickup outside the
 * operational day. A Ride already shown as urgent is left out, so Pozornost
 * lists it once. Names come from the catalogs this read already loaded.
 */
async function loadInvoiceWarnings(
  transaction: TenantTransaction,
  warnings: Awaited<ReturnType<typeof readInvoiceHomeNotices>>['warnings'],
  clients: Map<string, string>,
  places: Map<string, string>,
  drivers: Map<string, string>,
  vehicles: Map<string, string>,
  home: OfficeHome,
): Promise<OfficeHome['invoiceWarnings']> {
  if (warnings.length === 0)
    return []
  const urgent = new Set(
    officeHomeBlocks(home).attention.flatMap(group => group.rides.map(ride => ride.rideId)),
  )
  const kindByTransfer = new Map(warnings.map(warning => [warning.transferReference, warning.kind]))
  const ids = sql.join(warnings.map(warning => sql`${warning.transferReference}`), sql`, `)
  const selected = z.object({ rows: z.array(sourceRowSchema.omit({ declinedBy: true }).extend({
    transferId: z.uuid(),
  })) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.id as "transferId",
        t.pickup_at as "pickupAt",
        t.guest_name as "guestName",
        t.passenger_count as "passengerCount",
        t.client_id as "clientId",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        r.state,
        r.driver_id as "driverId",
        r.vehicle_id as "vehicleId",
        r.must_accept as "mustAccept",
        t.price,
        t.payment,
        t.flight_number as "flightNumber",
        t.landing_at as "landingAt",
        t.expected_arrival_at as "expectedArrival",
        t.tabla
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where t.id in (${ids})
    `),
    'Office home read failed',
  ))
  const rows: OfficeHome['invoiceWarnings'] = []
  for (const row of selected.rows) {
    const kind = kindByTransfer.get(row.transferId)
    if (kind === undefined || urgent.has(row.rideId))
      continue
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    if (start === undefined || end === undefined)
      throw new Error('Office home read failed')
    rows.push({
      rideId: row.rideId,
      pickupAt: toInstant(row.pickupAt),
      guestName: row.guestName,
      passengerCount: row.passengerCount,
      clientName: requiredName(row.clientId, clients),
      start,
      end,
      state: row.state,
      driverName: named(row.driverId, drivers),
      vehiclePlate: named(row.vehicleId, vehicles),
      price: toPrice(row.price),
      payment: row.payment,
      flightNumber: row.flightNumber,
      landingAt: row.landingAt == null ? null : toInstant(row.landingAt),
      expectedArrival: row.expectedArrival == null ? null : toInstant(row.expectedArrival),
      tabla: row.tabla,
      kind,
    })
  }
  rows.sort((a, b) => {
    const delta = a.pickupAt < b.pickupAt ? -1 : a.pickupAt > b.pickupAt ? 1 : 0
    if (delta !== 0)
      return delta
    return a.rideId < b.rideId ? -1 : a.rideId > b.rideId ? 1 : 0
  })
  return rows
}

/** A missing Driver or Vehicle for an id that is set fails the whole read. A null id is an empty name. */
function named(id: string | null, names: Map<string, string>): string | null {
  if (id === null)
    return null
  return requiredName(id, names)
}

/** A set id with no catalog row fails the whole read. The name is not logged. */
function requiredName(id: string, names: Map<string, string>): string {
  const name = names.get(id)
  if (name === undefined)
    throw new Error('Office home read failed')
  return name
}

/**
 * The declining Driver's display name.
 * `loadDrivers` returns every Driver row. There is no deactivated Driver.
 * An id missing from that list uses a neutral mark, so one absent name
 * does not fail the snapshot. The mark is not logged.
 */
function declineDriverName(id: string, names: Map<string, string>): string {
  return names.get(id) ?? MISSING_DECLINE_DRIVER
}
