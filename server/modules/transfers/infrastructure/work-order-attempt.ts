import type { WorkOrderStatus } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { LoadedWorkOrderEntry, OutboxAttemptStore, WorkOrderCurrentFacts } from '../../mail'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { composeWorkOrder, locationLabel, paymentMethodSchema, transferGroupRole } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadClient } from '../../clients'
import { loadLocation } from '../../locations'
import { OutboxComposeError, saveOutboxAttempt } from '../../mail'
import { ResendTransportError } from '../../tenancy'
import { loadVehicle } from '../../vehicles'
import { toPrice } from './transfers'

/**
 * `done` and `no-show` are finished. `cancelled` is reported on its own,
 * because the cancellation notice is still sent (Damir 18.10.).
 */
const FINISHED_RIDE_STATES = new Set(['done', 'no-show'])

const attemptRows = z.object({
  rows: z.array(z.object({
    driverId: z.uuid(),
    vehicleId: z.uuid().nullable(),
    status: z.enum(['assigned', 'changed', 'cancelled', 'no_longer_yours']),
    state: z.enum(['pending', 'sent', 'failed', 'stale']),
    attemptCount: z.number().int(),
    nextAttemptAt: z.unknown(),
    rideState: z.string(),
    superseded: z.boolean(),
    rideVehicleId: z.uuid().nullable(),
    pickupAt: z.unknown(),
    startLocationId: z.uuid(),
    endLocationId: z.uuid(),
    guestName: z.string(),
    tabla: z.string(),
    passengerCount: z.number().int(),
    luggageCount: z.number().int(),
    childSeatCount: z.number().int(),
    flightNumber: z.string().nullable(),
    clientId: z.uuid(),
    clientReference: z.string().nullable(),
    mainTransferId: z.uuid().nullable(),
    // The stored ordered count classifies a main Transfer. It is not mailed.
    storedGroupPassengerCount: z.number().int().nullable(),
    note: z.string().nullable(),
    payment: paymentMethodSchema,
    price: z.union([z.string(), z.number()]),
    email: z.string().nullable(),
    locale: z.enum(['hr', 'en']),
    timeZone: z.string().min(1),
  })),
})

/**
 * The work order as a retry has to see it, locked on this transaction.
 * "No longer yours" names the Vehicle stored on the entry. The Ride has
 * already let that Vehicle go, so the Ride's vehicle id is the wrong one.
 * Every other status names the Vehicle on the Ride now.
 * A missing row is null. A bad row is a fixed error, so a guest or a plate
 * cannot ride out on a database message.
 * No role check: the worker has no actor. HTTP use is the worker-used loader list (#344).
 */
export async function loadOutboxAttempt(
  transaction: TenantTransaction,
  entryId: string,
): Promise<LoadedWorkOrderEntry | null> {
  const id = z.uuid().parse(entryId)
  const row = await hideDatabaseError(async () => {
    const parsed = attemptRows.parse(await transaction.execute(sql`
      select
        o.driver_id as "driverId",
        o.vehicle_id as "vehicleId",
        o.work_order_status as "status",
        o.state,
        o.attempt_count as "attemptCount",
        o.next_attempt_at as "nextAttemptAt",
        r.state as "rideState",
        -- Same Ride and the same Driver. Another Driver's later mail does not replace this one.
        exists (
          select 1
          from app.mail_outbox as newer
          where newer.tenant_id = o.tenant_id
            and newer.ride_id = o.ride_id
            and newer.driver_id = o.driver_id
            and newer.kind = 'work_order'
            and newer.created_at > o.created_at
        ) as "superseded",
        r.vehicle_id as "rideVehicleId",
        t.pickup_at as "pickupAt",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        t.guest_name as "guestName",
        t.tabla,
        t.passenger_count as "passengerCount",
        t.luggage_count as "luggageCount",
        t.child_seat_count as "childSeatCount",
        t.flight_number as "flightNumber",
        t.client_id as "clientId",
        t.client_reference as "clientReference",
        t.link as "mainTransferId",
        t.group_passenger_count as "storedGroupPassengerCount",
        t.note,
        t.payment,
        t.price,
        d.email,
        s.default_locale as "locale",
        s.time_zone as "timeZone"
      from app.mail_outbox as o
      join app.rides as r
        on r.id = o.ride_id and r.tenant_id = o.tenant_id
      join app.transfers as t
        on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      join app.drivers as d
        on d.id = o.driver_id and d.tenant_id = o.tenant_id
      join app.tenant_settings as s
        on s.tenant_id = o.tenant_id
      where o.id = ${id}
        and o.kind = 'work_order'
      for update of o
    `))
    return parsed.rows[0] ?? null
  }, 'Mail outbox read failed')
  if (!row)
    return null
  const loaded = entryFromRow(id, row, null)
  let message: LoadedWorkOrderEntry['message']
  try {
    message = await composeAttempt(transaction, row)
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    throw new OutboxComposeError(loaded)
  }
  return { ...loaded, message }
}

const currentRows = z.object({
  rows: z.array(z.object({
    status: z.enum(['assigned', 'changed', 'cancelled', 'no_longer_yours']),
    rideState: z.string(),
    superseded: z.boolean(),
  })),
})

/**
 * Current-ness for the first attempt, without composing the mail.
 * The body still comes from the snapshot. This read only decides whether
 * that snapshot is still worth sending. A missing row is null.
 */
export async function readWorkOrderCurrentFacts(
  transaction: TenantTransaction,
  entryId: string,
): Promise<WorkOrderCurrentFacts | null> {
  const id = z.uuid().parse(entryId)
  const parsed = currentRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select
      o.work_order_status as "status",
      r.state as "rideState",
      -- Same Ride and the same Driver. Another Driver's later mail does not replace this one.
      exists (
        select 1
        from app.mail_outbox as newer
        where newer.tenant_id = o.tenant_id
          and newer.ride_id = o.ride_id
          and newer.driver_id = o.driver_id
          and newer.kind = 'work_order'
          and newer.created_at > o.created_at
      ) as "superseded"
    from app.mail_outbox as o
    join app.rides as r
      on r.id = o.ride_id and r.tenant_id = o.tenant_id
    where o.id = ${id}
      and o.kind = 'work_order'
    for update of o
  `), 'Mail outbox read failed'))
  const row = parsed.rows[0]
  if (!row)
    return null
  return factsFrom(row.status, row.rideState, row.superseded)
}

function factsFrom(status: WorkOrderCurrentFacts['status'], rideState: string, superseded: boolean): WorkOrderCurrentFacts {
  return {
    status,
    rideFinished: FINISHED_RIDE_STATES.has(rideState),
    rideCancelled: rideState === 'cancelled',
    superseded,
  }
}

function entryFromRow(entryId: string, row: AttemptRow, message: LoadedWorkOrderEntry['message']): LoadedWorkOrderEntry {
  return {
    kind: 'work_order',
    entryId,
    driverId: row.driverId,
    ...factsFrom(row.status, row.rideState, row.superseded),
    email: row.email,
    state: row.state,
    attemptCount: row.attemptCount,
    nextAttemptAt: toOptionalInstant(row.nextAttemptAt),
    message,
  }
}

/** A store that only reads work orders. */
export interface WorkOrderAttemptStore extends OutboxAttemptStore {
  load: (entryId: string) => Promise<LoadedWorkOrderEntry | null>
}

/** Work order store bound to the job's tenant transaction. The save is the mail module's, for any kind. No role check (#344). */
export function outboxAttemptStore(transaction: TenantTransaction): WorkOrderAttemptStore {
  return {
    load: entryId => loadOutboxAttempt(transaction, entryId),
    save: (entryId, patch) => saveOutboxAttempt(transaction, entryId, patch),
  }
}

type AttemptRow = z.infer<typeof attemptRows>['rows'][number]

/**
 * Compose from the current booking. The released Vehicle is `vehicle_id`
 * on the entry when the status is no longer yours. The Ride's vehicle is
 * used otherwise. One read at a time: parallel queries on this transaction trip the driver.
 */
async function composeAttempt(
  transaction: TenantTransaction,
  row: AttemptRow,
): Promise<LoadedWorkOrderEntry['message']> {
  const vehicleId = vehicleForAttempt(row.status, row.vehicleId, row.rideVehicleId)
  if (vehicleId === null)
    return null
  const client = await loadClient(transaction, row.clientId)
  const pickup = await loadLocation(transaction, row.startLocationId)
  const dropOff = await loadLocation(transaction, row.endLocationId)
  const vehicle = await loadVehicle(transaction, vehicleId)
  return composeWorkOrder({
    locale: row.locale,
    timeZone: row.timeZone,
    pickupAt: toInstant(row.pickupAt),
    pickupPlace: locationLabel(pickup),
    dropOffPlace: locationLabel(dropOff),
    guestName: row.guestName,
    tabla: row.tabla,
    passengerCount: row.passengerCount,
    luggageCount: row.luggageCount,
    childSeatCount: row.childSeatCount,
    flightNumber: row.flightNumber,
    clientName: client.name,
    clientReference: row.clientReference,
    groupRole: transferGroupRole(row.mainTransferId, row.storedGroupPassengerCount),
    vehicleName: vehicle.description,
    vehiclePlate: vehicle.registrationPlate,
    note: row.note,
    payment: row.payment,
    price: toPrice(row.price),
  }, row.status)
}

/**
 * No longer yours names the Vehicle the entry stored when the Ride let it go.
 * A later assignment must not replace that plate. Other statuses name the
 * Vehicle the Ride has now.
 */
function vehicleForAttempt(
  status: WorkOrderStatus,
  releasedVehicleId: string | null,
  rideVehicleId: string | null,
): string | null {
  if (status === 'no_longer_yours')
    return releasedVehicleId
  return rideVehicleId
}

function toInstant(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()))
      return parsed
  }
  throw new Error('Mail outbox read failed')
}

function toOptionalInstant(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  return toInstant(value)
}
