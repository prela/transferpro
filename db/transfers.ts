import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, integer, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { CHILD_SEAT_COUNT_MAX, CHILD_SEAT_COUNT_MIN, FLIGHT_NUMBER_MAX_LENGTH, GUEST_NAME_MAX_LENGTH, LUGGAGE_COUNT_MAX, LUGGAGE_COUNT_MIN, NOTE_MAX_LENGTH, PASSENGER_COUNT_MAX, PASSENGER_COUNT_MIN, PAYMENT_METHODS, RIDE_STATES } from '../shared'
import { clients } from './clients'
import { locations } from './locations'
import { tenantTable } from './tenant-table'

/**
 * One Transfer, many per Tenant.
 * `tenant_id` defaults to the session. The body never supplies it.
 * Start and end are Locations in this Tenant. The Client is too: the
 * composite foreign keys refuse another Tenant's id.
 * Price is EUR, numeric(10, 2), and may be zero. The airport mark is stored
 * as entered. There is no delete in this slice.
 * FORCE RLS and the grant are in the migration; drizzle-kit cannot emit them.
 */

const payments = sql.raw(PAYMENT_METHODS.map(method => `'${method}'`).join(', '))
const guestMax = sql.raw(String(GUEST_NAME_MAX_LENGTH))
const flightMax = sql.raw(String(FLIGHT_NUMBER_MAX_LENGTH))
const noteMax = sql.raw(String(NOTE_MAX_LENGTH))
const passengersMin = sql.raw(String(PASSENGER_COUNT_MIN))
const passengersMax = sql.raw(String(PASSENGER_COUNT_MAX))
const luggageMin = sql.raw(String(LUGGAGE_COUNT_MIN))
const luggageMax = sql.raw(String(LUGGAGE_COUNT_MAX))
const seatsMin = sql.raw(String(CHILD_SEAT_COUNT_MIN))
const seatsMax = sql.raw(String(CHILD_SEAT_COUNT_MAX))

export const transfers = tenantTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  pickupAt: timestamp('pickup_at', { withTimezone: true, mode: 'date' }).notNull(),
  startLocationId: uuid('start_location_id').notNull(),
  endLocationId: uuid('end_location_id').notNull(),
  passengerCount: integer('passenger_count').notNull(),
  guestName: text('guest_name').notNull(),
  flightNumber: text('flight_number'),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  payment: text('payment').notNull(),
  airportMark: boolean('airport_mark').notNull(),
  luggageCount: integer('luggage_count').notNull(),
  childSeatCount: integer('child_seat_count').notNull(),
  note: text('note'),
}, table => [
  uniqueIndex('transfers_tenant_id_id').on(table.tenantId, table.id),
  // The day list reads one Tenant's pickups in instant order.
  index('transfers_tenant_pickup_at').on(table.tenantId, table.pickupAt),
  foreignKey({
    name: 'transfers_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [clients.tenantId, clients.id],
  }),
  foreignKey({
    name: 'transfers_start_location_fk',
    columns: [table.tenantId, table.startLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }),
  foreignKey({
    name: 'transfers_end_location_fk',
    columns: [table.tenantId, table.endLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }),
  check('transfers_passenger_count', sql`${table.passengerCount} between ${passengersMin} and ${passengersMax}`),
  check('transfers_guest_name', sql`${table.guestName} = btrim(${table.guestName}) and length(${table.guestName}) between 1 and ${guestMax}`),
  check('transfers_flight_number', sql`${table.flightNumber} is null or (${table.flightNumber} = btrim(${table.flightNumber}) and length(${table.flightNumber}) between 1 and ${flightMax})`),
  check('transfers_price', sql`${table.price} >= 0`),
  check('transfers_payment', sql`${table.payment} in (${payments})`),
  check('transfers_luggage_count', sql`${table.luggageCount} between ${luggageMin} and ${luggageMax}`),
  check('transfers_child_seat_count', sql`${table.childSeatCount} between ${seatsMin} and ${seatsMax}`),
  check('transfers_note', sql`${table.note} is null or (${table.note} = btrim(${table.note}) and length(${table.note}) between 1 and ${noteMax})`),
], { oneRowPerTenant: false })

/**
 * The execution of one Transfer. v1 has exactly one Ride, created with it,
 * in `unassigned`, with no Driver and no Vehicle. The row is never deleted.
 * `transfer_id` is unique, so a second Ride cannot be inserted.
 * The state check lists every ADR-0005 state. This slice writes `unassigned`
 * only, and that state has neither a Driver nor a Vehicle.
 * Driver and Vehicle columns stay null until #19 adds the composite keys.
 */

const states = sql.raw(RIDE_STATES.map(state => `'${state}'`).join(', '))

export const rides = tenantTable('rides', {
  id: uuid('id').primaryKey().defaultRandom(),
  transferId: uuid('transfer_id').notNull(),
  state: text('state').notNull(),
  driverId: uuid('driver_id'),
  vehicleId: uuid('vehicle_id'),
}, table => [
  uniqueIndex('rides_transfer_id').on(table.transferId),
  foreignKey({
    name: 'rides_transfer_fk',
    columns: [table.tenantId, table.transferId],
    foreignColumns: [transfers.tenantId, transfers.id],
  }),
  check('rides_state', sql`${table.state} in (${states})`),
  check('rides_unassigned_open', sql`${table.state} <> 'unassigned' or (${table.driverId} is null and ${table.vehicleId} is null)`),
], { oneRowPerTenant: false })
