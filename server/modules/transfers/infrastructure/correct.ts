import type { SQL } from 'drizzle-orm'
import type { CorrectedTransferResult, CreateTransfer, RecordedTransfer, ScheduleClash, TransferCorrectionField } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canCorrectTransfer, changedTransferFields, correctionReturnsAcceptedRide, flightNumberChangeClearsLanding, officeGroupPassengerCount, parseCorrectTransfer, paymentMethodSchema, RIDE_ACCEPTED_FIELDS, rideStateSchema, TRANSFER_CORRECTION_FIELDS, TransferInputError } from '../../../../shared'
import { hideDatabaseError, loadAppEnv } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { correctionMovesWindow, lockTenantCapacity, tenantCapacityMinutes } from '../../capacity'
import { ClientNotFoundError, loadClients } from '../../clients'
import { loadLocation, LocationArchivedError } from '../../locations'
import { mailerForApp, TenantAccessError, withOfficeWrite } from '../../tenancy'
import { checkRideCapacity, transferFullyBooked } from './capacity-check'
import { mailOutboxQueue } from './mail-outbox-worker'
import { ExtraVehicleCountError, ExtraVehiclePriceError, TransferNotCorrectableError, TransferNotFoundError } from './transfer-errors'
import { refuseStaleVersion, StaleSaveError } from './transfer-version'
import { toInstant, toPrice } from './transfers'
import { deliverStagedWorkOrder, readAssignedWorkOrder, stageWorkOrder } from './work-order'

export { ExtraVehicleCountError, ExtraVehiclePriceError, TransferNotCorrectableError, TransferNotFoundError, TransferNotMainError } from './transfer-errors'

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
    clientReference: z.string().nullable(),
    mainTransferId: z.uuid().nullable(),
    groupPassengerCount: z.number().int().nullable(),
    rideId: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
    landingAt: z.unknown().nullable(),
    version: z.number().int(),
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
function parseCorrect(transferId: unknown, body: unknown): { id: string, input: CreateTransfer, confirm: boolean, version: number, groupPassengerCount: number | null } {
  const id = z.uuid().safeParse(transferId)
  if (!id.success)
    throw new TransferInputError()
  const parsed = parseCorrectTransfer(body)
  return {
    id: id.data,
    input: parsed.input,
    confirm: parsed.confirm,
    version: parsed.version,
    groupPassengerCount: parsed.groupPassengerCount,
  }
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
 * mails only while payment is cash. A Client reference change mails. The
 * group's ordered passenger count does not. A Ride with no Driver sends nothing. A
 * rejected send leaves the correction. Tests pass a mailer. The address
 * is not on the result.
 */
export async function correctTransfer(
  headers: Headers,
  rawId: unknown,
  rawBody: unknown,
  delivery?: { mailer: Mailer, logger?: Logger },
): Promise<CorrectedTransferResult> {
  const queue = await mailOutboxQueue()
  const saved = await withOfficeWrite(headers, rawBody, body => parseCorrect(rawId, body), async ({ actor, context, transaction }, parsed) => {
    officeOnly(actor.role)
    const corrected = await correctTransferForOffice(transaction, actor.userId, parsed.id, parsed.input, parsed.confirm, parsed.version, parsed.groupPassengerCount)
    // The snapshot needs a Driver. An unassigned correction has nobody to mail.
    if (!corrected.notify || corrected.recorded.ride.driverId === null)
      return { recorded: corrected.recorded, staged: null, relocationWarnings: corrected.relocationWarnings, fullyBooked: corrected.fullyBooked }
    const order = await readAssignedWorkOrder(transaction, corrected.recorded.ride.id)
    const staged = await stageWorkOrder(transaction, order, 'changed', { queue, context })
    return { recorded: corrected.recorded, staged, relocationWarnings: corrected.relocationWarnings, fullyBooked: corrected.fullyBooked }
  })
  if (saved.staged === null)
    return { ...saved.recorded, workOrders: [], relocationWarnings: saved.relocationWarnings, fullyBooked: saved.fullyBooked }
  const mailer = delivery?.mailer ?? mailerForApp(loadAppEnv())
  const notice = await deliverStagedWorkOrder(headers, saved.staged, mailer, delivery?.logger)
  return { ...saved.recorded, workOrders: [notice], relocationWarnings: saved.relocationWarnings, fullyBooked: saved.fullyBooked }
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
  version: number,
  groupPassengerCount: number | null,
): Promise<{ recorded: RecordedTransfer, notify: boolean, relocationWarnings: ScheduleClash[], fullyBooked: boolean }> {
  const current = await lockTransfer(transaction, transferId)
  if (!current)
    throw new TransferNotFoundError()
  // A mismatch is refused before the closed-Ride rule, even when the body
  // matches the stored booking. A form that still holds this version and
  // finds the Ride finished is the existing closed error.
  refuseStaleVersion(current.version, version)
  if (!canCorrectTransfer(current.state))
    throw new TransferNotCorrectableError()
  // An extra vehicle keeps Price 0 and has no group count. Either refusal
  // writes nothing, including when the rest of the body matches the row.
  if (current.mainTransferId !== null && input.price !== '0.00')
    throw new ExtraVehiclePriceError()
  if (current.mainTransferId !== null && groupPassengerCount !== null)
    throw new ExtraVehicleCountError()

  await requireLiveBooking(transaction, input)
  const stored = toBooking(current)
  const changed = changedTransferFields(stored, input)
  // Absent leaves the stored count. A sent number that differs is a change
  // of the main Transfer only. The column value, not the office read, is
  // what "differs" means: empty stays empty until a number is sent.
  const groupChanged = groupPassengerCount !== null && groupPassengerCount !== current.groupPassengerCount
  const fields = TRANSFER_CORRECTION_FIELDS.filter(field => changed.includes(field) || (groupChanged && field === 'groupPassengerCount'))
  const nextGroup = groupPassengerCount ?? current.groupPassengerCount
  if (fields.length === 0)
    return { recorded: toRecorded(current, stored), notify: false, relocationWarnings: [], fullyBooked: false }

  // A different designator throws away the landing, the expected arrival,
  // and the will-not-arrive memory (ADR-0028). The occupation check reads
  // the row after this write, so a 409 rolls the clear back with the booking.
  const clearLanding = flightNumberChangeClearsLanding(stored.flightNumber, input.flightNumber)
  const occupation = await occupiedWindowMoves(transaction, current, input, clearLanding)
  // ADR-0034: only a judged correction is a capacity write. The lock comes
  // after the Transfer lock and the refusals above, before another Ride is read.
  if (occupation)
    await lockTenantCapacity(transaction)
  await writeTransfer(transaction, transferId, input, clearLanding, version, actorUserId, nextGroup)
  const capacity = occupation
    ? await checkRideCapacity(transaction, {
        rideId: current.rideId,
        driverId: occupation.driverId,
        vehicleId: occupation.vehicleId,
        confirm,
        // A correction is never refused as fully booked. It warns instead.
        blockFullyBooked: false,
      })
    : null
  const relocationWarnings = capacity?.relocationWarnings ?? []
  const fullyBooked = capacity !== null
    ? capacity.fullyBooked
    : await transferFullyBooked(transaction, {
        rideId: current.rideId,
        pickupAt: new Date(input.pickupAt),
        landingAt: clearLanding || current.landingAt == null ? null : new Date(toInstant(current.landingAt)),
        driverId: current.driverId,
        vehicleId: current.vehicleId,
      })
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
    fields,
  })
  if (returned && ride.driverId)
    await appendReturned(transaction, actorUserId, ride.id, ride.driverId)

  return {
    recorded: {
      transfer: presentTransfer(current.id, input, current.mainTransferId, nextGroup),
      ride,
    },
    // A mailed fact is the list in ADR-0026, plus a Client reference change
    // (ADR-0054). The price mails only while the Driver collects cash. The
    // group's ordered passenger count is not a work-order fact (ADR-0054).
    notify: fields.some(field => field !== 'groupPassengerCount' && (field !== 'price' || input.payment === 'cash')),
    relocationWarnings,
    fullyBooked,
  }
}

/**
 * The Driver and Vehicle already on an assigned or accepted Ride, when this
 * save moves the occupied window. A guest, a place, or a spacing change of
 * the same flight designator does not. An unassigned Ride is not judged.
 * Whether the window moves is capacity's rule (ADR-0029, ADR-0034).
 */
async function occupiedWindowMoves(
  transaction: TenantTransaction,
  current: LockedTransfer,
  input: CreateTransfer,
  clearLanding: boolean,
): Promise<{ driverId: string, vehicleId: string } | null> {
  // A handed-off Ride has no Driver and no Vehicle, so a correction is not judged (ADR-0048).
  if (current.driverId === null || current.vehicleId === null)
    return null
  if (current.state !== 'assigned' && current.state !== 'accepted')
    return null
  const beforeLanding = current.landingAt == null ? null : new Date(toInstant(current.landingAt))
  const moves = await correctionMovesWindow(
    tenantCapacityMinutes(transaction),
    { pickupAt: new Date(toInstant(current.pickupAt)), landingAt: beforeLanding },
    { pickupAt: new Date(input.pickupAt), landingAt: clearLanding ? null : beforeLanding },
  )
  return moves ? { driverId: current.driverId, vehicleId: current.vehicleId } : null
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
           t.client_reference as "clientReference",
           t.link as "mainTransferId",
           t.group_passenger_count as "groupPassengerCount",
           r.id as "rideId",
           r.state,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept",
           t.landing_at as "landingAt",
           t.version
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
    clientReference: row.clientReference,
  }
}

function presentTransfer(
  id: string,
  booking: CreateTransfer,
  mainTransferId: string | null,
  storedGroupPassengerCount: number | null,
) {
  return {
    id,
    ...booking,
    mainTransferId,
    groupPassengerCount: officeGroupPassengerCount(mainTransferId, storedGroupPassengerCount, booking.passengerCount),
  }
}

function toRecorded(row: LockedTransfer, booking: CreateTransfer): RecordedTransfer {
  return {
    transfer: presentTransfer(row.id, booking, row.mainTransferId, row.groupPassengerCount),
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
  version: number,
  actorUserId: string,
  groupPassengerCount: number | null,
): Promise<void> {
  // The version predicate is the compare-and-swap. The booking and the bump
  // are one update, so a concurrent correction cannot both pass. ADR-0046.
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
        client_reference = ${input.clientReference},
        group_passenger_count = ${groupPassengerCount},
        landing_at = case when ${clearLanding} then null else landing_at end,
        expected_arrival_at = case when ${clearLanding} then null else expected_arrival_at end,
        expected_arrival_basis_at = case when ${clearLanding} then null else expected_arrival_basis_at end,
        flight_will_not_arrive = case when ${clearLanding} then false else flight_will_not_arrive end,
        flight_will_not_arrive_handed = case when ${clearLanding} then false else flight_will_not_arrive_handed end,
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${transferId}
      and version = ${version}
    returning id
  `))
  if (!written.rows[0])
    throw new StaleSaveError()
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
