import type { SQL } from 'drizzle-orm'
import type { CreateTransfer, Ride, Transfer, TransferDayRide, TransferField } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { paymentMethodSchema, rideStateSchema, TRANSFER_FIELDS, transferPriceSchema } from '../../../../shared'
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
})

const rideRowSchema = z.object({
  id: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
})

const dayRowSchema = transferRowSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
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
  note
`

/**
 * Insert one Transfer and its one unassigned Ride, then append
 * `transfer.created` on this transaction. The entry names ids and field
 * names. It does not store the guest name, the flight, the note, or the price.
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
      airport_mark, luggage_count, child_seat_count, note
    )
    values (
      ${input.clientId}, ${input.pickupAt}, ${input.startLocationId}, ${input.endLocationId},
      ${input.passengerCount}, ${input.guestName}, ${input.flightNumber}, ${input.price}, ${input.payment},
      ${input.airportMark}, ${input.luggageCount}, ${input.childSeatCount}, ${input.note}
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
    returning id, transfer_id as "transferId", state, driver_id as "driverId", vehicle_id as "vehicleId"
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
 * Rides whose pickup falls on this calendar day in the Tenant time zone.
 * The day is `YYYY-MM-DD`. The zone is the Tenant's IANA name, bound as a
 * parameter. Pickup instants stay UTC on the row.
 */
export async function loadRidesForDay(
  transaction: TenantTransaction,
  day: string,
  timeZone: string,
): Promise<TransferDayRide[]> {
  const selected = z.object({ rows: z.array(dayRowSchema) }).parse(await transaction.execute(sql`
    select
      r.id as "rideId",
      r.transfer_id as "transferId",
      r.state,
      r.driver_id as "driverId",
      r.vehicle_id as "vehicleId",
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
      t.note
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where (t.pickup_at at time zone ${timeZone})::date = ${day}::date
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
  }
}

function toDayRide(row: z.infer<typeof dayRowSchema>): TransferDayRide {
  return {
    rideId: row.rideId,
    transferId: row.transferId,
    state: row.state,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
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
  }
}

/** node-pg may return a Date or a timestamp string. The API always uses ISO-8601 UTC. */
function toInstant(value: unknown): string {
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

/** numeric comes back as text. The API always uses two decimal places. */
function toPrice(value: string | number): string {
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
