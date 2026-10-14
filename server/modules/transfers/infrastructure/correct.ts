import type { SQL } from 'drizzle-orm'
import type { CorrectedTransferResult, CreateTransfer, RecordedTransfer, ScheduleClash, TransferCorrectionField } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canCorrectTransfer, changedTransferFields, correctionReturnsAcceptedRide, flightNumberChangeClearsLanding, occupiedEnd, parseCreateTransfer, paymentMethodSchema, RIDE_ACCEPTED_FIELDS, rideStateSchema, TRANSFER_CORRECTION_FIELDS, TransferInputError } from '../../../../shared'
import { hideDatabaseError, loadAppEnv } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError, loadClients } from '../../clients'
import { loadLocation, LocationArchivedError } from '../../locations'
import { loadTenantSettings, mailerForApp, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { checkRideSchedule } from './ride-schedule'
import { toInstant, toPrice } from './transfers'
import { deliverAssignedWorkOrder, readAssignedWorkOrder } from './work-order'

/** The Transfer is not in this Tenant. Another Tenant's row looks the same. */
export class TransferNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'TransferNotFoundError'
  }
}

/**
 * The Ride is finished. The booking stays as it was. Nothing is written.
 */
export class TransferNotCorrectableError extends Error {
  readonly statusCode = 409
  readonly code = 'transfer_closed'

  constructor() {
    super('Conflict')
    this.name = 'TransferNotCorrectableError'
  }
}

const lockedRows = z.object({
  rows: z.array(z.object({
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
    rideId: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
    landingAt: z.unknown().nullable(),
  })),
})

type LockedTransfer = z.infer<typeof lockedRows>['rows'][number]

const writtenRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

/**
 * Accepts a Transfer id and the same body as a new Transfer, plus an optional
 * `confirm`. A bad id or a bad body throws first, so the caller does not open
 * a session. `confirm` is only for a true overlap the office has already seen.
 * The record route does not accept it.
 */
function parseCorrect(transferId: unknown, body: unknown): { id: string, input: CreateTransfer, confirm: boolean } {
  const id = z.uuid().safeParse(transferId)
  if (!id.success)
    throw new TransferInputError()
  const record = z.record(z.string(), z.unknown()).safeParse(body)
  if (!record.success)
    throw new TransferInputError()
  const confirm = record.data.confirm
  if (confirm !== undefined && typeof confirm !== 'boolean')
    throw new TransferInputError()
  const { confirm: _confirm, ...booking } = record.data
  return { id: id.data, input: parseCreateTransfer(booking), confirm: confirm === true }
}

function officeOnly(role: string): void {
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * Correct a Transfer. The body is parsed first. A driver is refused and the
 * booking is unchanged. A finished Ride is refused. A save that matches the
 * stored booking writes nothing. A change of pickup, start, end, or flight
 * number on an accepted Ride returns it to assigned and keeps the Driver,
 * the Vehicle, and the copied flag. Spacing or case of the same designator
 * does not. A different designator also clears the landing time,
 * the expected arrival, and the memory of what the Driver was told.
 * A pickup move, or a flight-number change that moves the occupied end,
 * is judged like assign when the Ride already has a Driver. A true overlap
 * writes nothing unless `confirm` is set. A tight gap is returned and does
 * not refuse. After the booking commits, the current Driver is mailed one
 * work order with status changed when a mailed fact changed. A price change
 * mails only while payment is cash. A Ride with no Driver sends nothing. A
 * rejected send leaves the correction. Tests pass a mailer. The address
 * is not on the result.
 */
export async function correctTransfer(
  headers: Headers,
  rawId: unknown,
  rawBody: unknown,
  delivery?: { mailer: Mailer, logger?: Logger },
): Promise<CorrectedTransferResult> {
  const parsed = parseCorrect(rawId, rawBody)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const corrected = await correctTransferForOffice(transaction, actor.userId, parsed.id, parsed.input, parsed.confirm)
    // The snapshot needs a Driver. An unassigned correction has nobody to mail.
    if (!corrected.notify || corrected.recorded.ride.driverId === null)
      return { recorded: corrected.recorded, order: null, relocationWarnings: corrected.relocationWarnings }
    const order = await readAssignedWorkOrder(transaction, corrected.recorded.ride.id)
    return { recorded: corrected.recorded, order, relocationWarnings: corrected.relocationWarnings }
  })
  if (saved.order === null)
    return { ...saved.recorded, workOrders: [], relocationWarnings: saved.relocationWarnings }
  const mailer = delivery?.mailer ?? mailerForApp(loadAppEnv())
  const notice = await deliverAssignedWorkOrder(saved.order, mailer, delivery?.logger, 'changed')
  return { ...saved.recorded, workOrders: [notice], relocationWarnings: saved.relocationWarnings }
}

/**
 * The office correction, on the caller's transaction. The role allow-list
 * has already run. The audit rows commit with the writes. `notify` is true
 * when the current Driver should receive one changed work order after commit.
 * `relocationWarnings` is empty when the occupied window did not move.
 */
export async function correctTransferForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  transferId: string,
  input: CreateTransfer,
  confirm: boolean,
): Promise<{ recorded: RecordedTransfer, notify: boolean, relocationWarnings: ScheduleClash[] }> {
  const current = await lockTransfer(transaction, transferId)
  if (!current)
    throw new TransferNotFoundError()
  if (!canCorrectTransfer(current.state))
    throw new TransferNotCorrectableError()

  await requireLiveBooking(transaction, input)
  const stored = toBooking(current)
  const changed = changedTransferFields(stored, input)
  if (changed.length === 0)
    return { recorded: toRecorded(current, stored), notify: false, relocationWarnings: [] }

  // A different designator throws away the landing, the expected arrival,
  // and the will-not-arrive memory (ADR-0028). The occupation check reads
  // the row after this write, so a 409 rolls the clear back with the booking.
  const clearLanding = flightNumberChangeClearsLanding(stored.flightNumber, input.flightNumber)
  const judge = await occupiedWindowMoves(transaction, current, input, clearLanding)
  await writeTransfer(transaction, transferId, input, clearLanding)
  const relocationWarnings = judge
    ? await checkRideSchedule(transaction, {
        rideId: current.rideId,
        driverId: judge.driverId,
        vehicleId: judge.vehicleId,
        confirm,
      })
    : []
  const returned = correctionReturnsAcceptedRide(current.state, changed, {
    before: stored.flightNumber,
    after: input.flightNumber,
  })
  const ride = returned
    ? await returnAcceptedRide(transaction, current.rideId)
    : {
        id: current.rideId,
        transferId: current.id,
        state: current.state,
        driverId: current.driverId,
        vehicleId: current.vehicleId,
        mustAccept: current.mustAccept,
      }

  await appendCorrected(transaction, actorUserId, {
    transferId: current.id,
    rideId: ride.id,
    clientId: input.clientId,
    startLocationId: input.startLocationId,
    endLocationId: input.endLocationId,
    fields: changed,
  })
  if (returned && ride.driverId)
    await appendReturned(transaction, actorUserId, ride.id, ride.driverId)

  return {
    recorded: {
      transfer: { id: current.id, ...input },
      ride,
    },
    // Every stored field is a mailed fact except the price, and the price
    // only while the Driver collects cash. Card and invoice-to-agency keep
    // a fare change off the mail. ADR-0026.
    notify: changed.some(field => field !== 'price' || input.payment === 'cash'),
    relocationWarnings,
  }
}

/**
 * The Driver and Vehicle already on an assigned or accepted Ride, when this
 * save moves the occupied window. A guest, a place, or a spacing change of
 * the same flight designator does not. An unassigned Ride is not judged.
 * ADR-0029.
 */
async function occupiedWindowMoves(
  transaction: TenantTransaction,
  current: LockedTransfer,
  input: CreateTransfer,
  clearLanding: boolean,
): Promise<{ driverId: string, vehicleId: string } | null> {
  if (current.driverId === null || current.vehicleId === null)
    return null
  if (current.state !== 'assigned' && current.state !== 'accepted')
    return null
  const beforePickup = new Date(toInstant(current.pickupAt))
  const beforeLanding = current.landingAt == null ? null : new Date(toInstant(current.landingAt))
  const afterPickup = new Date(input.pickupAt)
  const afterLanding = clearLanding ? null : beforeLanding
  if (beforePickup.getTime() === afterPickup.getTime() && sameInstant(beforeLanding, afterLanding))
    return null
  // The end uses the Tenant duration. A landing clear moves it only when
  // the stored landing was not already the pickup.
  if (beforePickup.getTime() === afterPickup.getTime()) {
    const settings = await loadTenantSettings(transaction)
    const beforeEnd = occupiedEnd(beforePickup, beforeLanding, settings.transferDurationMinutes)
    const afterEnd = occupiedEnd(afterPickup, afterLanding, settings.transferDurationMinutes)
    if (beforeEnd.getTime() === afterEnd.getTime())
      return null
  }
  return { driverId: current.driverId, vehicleId: current.vehicleId }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null)
    return left === right
  return left.getTime() === right.getTime()
}

/** A hidden Location cannot be written onto the booking. The Client has to exist. */
async function requireLiveBooking(transaction: TenantTransaction, input: CreateTransfer): Promise<void> {
  const client = (await loadClients(transaction)).find(row => row.id === input.clientId)
  if (!client)
    throw new ClientNotFoundError()
  const start = await loadLocation(transaction, input.startLocationId)
  if (start.archivedAt !== null)
    throw new LocationArchivedError()
  const end = await loadLocation(transaction, input.endLocationId)
  if (end.archivedAt !== null)
    throw new LocationArchivedError()
}

async function lockTransfer(transaction: TenantTransaction, transferId: string): Promise<LockedTransfer | undefined> {
  return lockedRows.parse(await runStep(transaction, sql`
    select t.id,
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
           t.tabla,
           r.id as "rideId",
           r.state,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept",
           t.landing_at as "landingAt"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where t.id = ${transferId}
    for update
  `)).rows[0]
}

function toBooking(row: LockedTransfer): CreateTransfer {
  return {
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

function toRecorded(row: LockedTransfer, booking: CreateTransfer): RecordedTransfer {
  return {
    transfer: { id: row.id, ...booking },
    ride: {
      id: row.rideId,
      transferId: row.id,
      state: row.state,
      driverId: row.driverId,
      vehicleId: row.vehicleId,
      mustAccept: row.mustAccept,
    },
  }
}

async function writeTransfer(
  transaction: TenantTransaction,
  transferId: string,
  input: CreateTransfer,
  clearLanding: boolean,
): Promise<void> {
  const written = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await runStep(transaction, sql`
    update app.transfers
    set client_id = ${input.clientId},
        pickup_at = ${input.pickupAt},
        start_location_id = ${input.startLocationId},
        end_location_id = ${input.endLocationId},
        passenger_count = ${input.passengerCount},
        guest_name = ${input.guestName},
        flight_number = ${input.flightNumber},
        price = ${input.price},
        payment = ${input.payment},
        airport_mark = ${input.airportMark},
        luggage_count = ${input.luggageCount},
        child_seat_count = ${input.childSeatCount},
        note = ${input.note},
        tabla = ${input.tabla},
        landing_at = case when ${clearLanding} then null else landing_at end,
        expected_arrival_at = case when ${clearLanding} then null else expected_arrival_at end,
        expected_arrival_basis_at = case when ${clearLanding} then null else expected_arrival_basis_at end,
        flight_will_not_arrive = case when ${clearLanding} then false else flight_will_not_arrive end,
        flight_will_not_arrive_handed = case when ${clearLanding} then false else flight_will_not_arrive_handed end
    where id = ${transferId}
    returning id
  `))
  if (!written.rows[0])
    throw new TransferNotCorrectableError()
}

/**
 * Sets `assigned` only while the Ride is still `accepted`. The Driver, the
 * Vehicle, and the copied flag are not rewritten. Zero rows means a
 * concurrent command won.
 */
async function returnAcceptedRide(transaction: TenantTransaction, rideId: string) {
  const updated = writtenRows.parse(await runStep(transaction, sql`
    update app.rides
    set state = 'assigned'
    where id = ${rideId}
      and state = 'accepted'
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  if (!updated)
    throw new TransferNotCorrectableError()
  return updated
}

async function appendCorrected(
  transaction: TenantTransaction,
  actorUserId: string,
  data: {
    transferId: string
    rideId: string
    clientId: string
    startLocationId: string
    endLocationId: string
    fields: TransferCorrectionField[]
  },
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'transfer.corrected',
    actorUserId,
    subjectUserId: null,
    data: {
      ...data,
      fields: TRANSFER_CORRECTION_FIELDS.filter(field => data.fields.includes(field)),
    },
  }), 'Transfer correct failed')
}

async function appendReturned(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  driverId: string,
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.returned_to_assigned',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      fields: [...RIDE_ACCEPTED_FIELDS],
    },
  }), 'Transfer correct failed')
}

function runStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Transfer correct failed')
}
