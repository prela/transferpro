import type { SQL } from 'drizzle-orm'
import type { CreateTransfer, Ride, Transfer, TransferDayRide, TransferField } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { localDayBounds, OPERATIONAL_DAY_START_DEFAULT, paymentMethodSchema, rideStateSchema, TRANSFER_FIELDS, transferPriceSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError, loadClients } from '../../clients'
import { loadLocation, LocationArchivedError } from '../../locations'

const transferRowSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int(),
  guestName: z.string(),
  flightNumber: z.string().nullable(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
  airportMark: z.boolean(),
  luggageCount: z.number().int(),
  childSeatCount: z.number().int(),
  note: z.string().nullable(),
  tabla: z.string(),
})

const rideRowSchema = z.object({
  id: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
})

const dayRowSchema = transferRowSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
})

const transferColumns = sql`
  id,
  client_id as "clientId",
  pickup_at as "pickupAt",
  start_location_id as "startLocationId",
  end_location_id as "endLocationId",
  passenger_count as "passengerCount",
  guest_name as "guestName",
  flight_number as "flightNumber",
  price,
  payment,
  airport_mark as "airportMark",
  luggage_count as "luggageCount",
  child_seat_count as "childSeatCount",
  note,
  tabla
`

/**
 * Insert one Transfer and its one unassigned Ride, then append
 * `transfer.created` on this transaction. The entry names ids and field
 * names. It does not store the guest name, the flight, the note, the tabla, or the price.
 * The caller has already required a dispatcher or an admin, and has already
 * checked that role before loading the Client and the Locations.
 */
export async function recordTransfer(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateTransfer,
): Promise<{ transfer: Transfer, ride: Ride }> {
  const client = (await loadClients(transaction)).find(row => row.id === input.clientId)
  if (!client)
    throw new ClientNotFoundError()

  const start = await loadLocation(transaction, input.startLocationId)
  if (start.archivedAt !== null)
    throw new LocationArchivedError()
  const end = await loadLocation(transaction, input.endLocationId)
  if (end.archivedAt !== null)
    throw new LocationArchivedError()

  const inserted = z.object({ rows: z.array(transferRowSchema) }).parse(await writeTransfer(transaction, sql`
    insert into app.transfers (
      client_id, pickup_at, start_location_id, end_location_id,
      passenger_count, guest_name, flight_number, price, payment,
      airport_mark, luggage_count, child_seat_count, note, tabla
    )
    values (
      ${input.clientId}, ${input.pickupAt}, ${input.startLocationId}, ${input.endLocationId},
      ${input.passengerCount}, ${input.guestName}, ${input.flightNumber}, ${input.price}, ${input.payment},
      ${input.airportMark}, ${input.luggageCount}, ${input.childSeatCount}, ${input.note}, ${input.tabla}
    )
    returning ${transferColumns}
  `))
  const transferRow = inserted.rows[0]
  if (!transferRow)
    throw new Error('Transfer write failed')
  const transfer = toTransfer(transferRow)

  const rideInserted = z.object({ rows: z.array(rideRowSchema) }).parse(await writeTransfer(transaction, sql`
    insert into app.rides (transfer_id, state)
    values (${transfer.id}, 'unassigned')
    returning id, transfer_id as "transferId", state, driver_id as "driverId", vehicle_id as "vehicleId", must_accept as "mustAccept"
  `))
  const rideRow = rideInserted.rows[0]
  if (!rideRow)
    throw new Error('Transfer write failed')
  const ride = rideRow

  await appendAuditEntry(transaction, {
    action: 'transfer.created',
    actorUserId,
    subjectUserId: null,
    data: {
      transferId: transfer.id,
      rideId: ride.id,
      clientId: transfer.clientId,
      startLocationId: transfer.startLocationId,
      endLocationId: transfer.endLocationId,
      fields: createdFields(input),
    },
  })
  return { transfer, ride }
}

/**
 * Rides whose pickup falls on this operational day in the Tenant time zone.
 * The day is `YYYY-MM-DD`, the date of the local start hour. The bounds are
 * that hour and the same hour next date, as UTC instants, so the
 * `(tenant_id, pickup_at)` index can serve the list. A `date` cast of the
 * stored instant cannot, and it would also miss the extra hour or keep the
 * missing hour of a daylight-saving night. A pickup before the start hour is
 * not in this interval; it belongs to the previous operational day.
 * Omitting the hour uses 05:00. The day list passes the stored hour.
 */
export async function loadRidesForDay(
  transaction: TenantTransaction,
  day: string,
  timeZone: string,
  startHour = OPERATIONAL_DAY_START_DEFAULT,
): Promise<TransferDayRide[]> {
  const bounds = localDayBounds(day, timeZone, startHour)
  const selected = z.object({ rows: z.array(dayRowSchema) }).parse(await transaction.execute(sql`
    select
      r.id as "rideId",
      r.transfer_id as "transferId",
      r.state,
      r.driver_id as "driverId",
      r.vehicle_id as "vehicleId",
      r.must_accept as "mustAccept",
      t.client_id as "clientId",
      t.pickup_at as "pickupAt",
      t.start_location_id as "startLocationId",
      t.end_location_id as "endLocationId",
      t.passenger_count as "passengerCount",
      t.guest_name as "guestName",
      t.flight_number as "flightNumber",
      t.price,
      t.payment,
      t.airport_mark as "airportMark",
      t.luggage_count as "luggageCount",
      t.child_seat_count as "childSeatCount",
      t.note,
      t.tabla
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where t.pickup_at >= ${bounds.start.toISOString()} and t.pickup_at < ${bounds.end.toISOString()}
    order by t.pickup_at, r.id
  `))
  return selected.rows.map(toDayRide)
}

function createdFields(input: CreateTransfer): TransferField[] {
  const set = new Set<TransferField>([
    'pickupAt',
    'passengerCount',
    'guestName',
    'price',
    'payment',
    'airportMark',
    'luggageCount',
    'childSeatCount',
  ])
  if (input.flightNumber !== null)
    set.add('flightNumber')
  if (input.note !== null)
    set.add('note')
  if (input.tabla !== '')
    set.add('tabla')
  return TRANSFER_FIELDS.filter(field => set.has(field))
}

function toTransfer(row: z.infer<typeof transferRowSchema>): Transfer {
  return {
    id: row.id,
    clientId: row.clientId,
    pickupAt: toInstant(row.pickupAt),
    startLocationId: row.startLocationId,
    endLocationId: row.endLocationId,
    passengerCount: row.passengerCount,
    guestName: row.guestName,
    flightNumber: row.flightNumber,
    price: toPrice(row.price),
    payment: row.payment,
    airportMark: row.airportMark,
    luggageCount: row.luggageCount,
    childSeatCount: row.childSeatCount,
    note: row.note,
    tabla: row.tabla,
  }
}

function toDayRide(row: z.infer<typeof dayRowSchema>): TransferDayRide {
  return {
    rideId: row.rideId,
    transferId: row.transferId,
    state: row.state,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    mustAccept: row.mustAccept,
    clientId: row.clientId,
    pickupAt: toInstant(row.pickupAt),
    startLocationId: row.startLocationId,
    endLocationId: row.endLocationId,
    passengerCount: row.passengerCount,
    guestName: row.guestName,
    flightNumber: row.flightNumber,
    price: toPrice(row.price),
    payment: row.payment,
    airportMark: row.airportMark,
    luggageCount: row.luggageCount,
    childSeatCount: row.childSeatCount,
    note: row.note,
    tabla: row.tabla,
  }
}

/**
 * node-pg may return a Date or a timestamp string. The API always uses ISO-8601 UTC.
 * The office home read uses the same conversion.
 */
export function toInstant(value: unknown): string {
  if (value instanceof Date)
    return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('Transfer pickup_at is not a timestamp.')
    return parsed.toISOString()
  }
  throw new Error('Transfer pickup_at is not a timestamp.')
}

/** numeric comes back as text. The API always uses two decimal places. The office home read uses this too. */
export function toPrice(value: string | number): string {
  const parsed = transferPriceSchema.safeParse(typeof value === 'number' ? value.toFixed(2) : normalizePriceText(value))
  if (!parsed.success)
    throw new Error('Transfer price is not numeric.')
  return parsed.data
}

function normalizePriceText(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    return value
  const cents = Math.round(Number(value) * 100)
  const whole = Math.trunc(cents / 100)
  const fraction = String(cents % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}

/**
 * Run one insert. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. A guest name
 * in that text would otherwise land in the log.
 */
async function writeTransfer(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch {
    throw new Error('Transfer write failed')
  }
}
