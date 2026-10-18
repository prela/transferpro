import type { DisplayLocale, PaymentMethod, WorkOrderNotice, WorkOrderStatus } from '../../../../shared'
import type { JobQueue, Logger, TenantContext, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { composeWorkOrder, locationLabel, paymentMethodSchema } from '../../../../shared'
import { getLogger, hideDatabaseError } from '../../../core/index'
import { loadClient } from '../../clients'
import { loadLocation } from '../../locations'
import { enqueueMailOutboxJob, MAIL_RETRY_DELAYS_MS, noteWorkOrderAttempt, recordWorkOrder, workOrderIdempotencyKey } from '../../mail'
import { ResendTransportError, withTenantFromSession } from '../../tenancy'
import { loadVehicle } from '../../vehicles'
import { toPrice } from './transfers'

/**
 * The assigned Ride as the mail will describe it, read on the assign
 * transaction. `locale` and `timeZone` are the Tenant settings. The
 * member's UI locale is not selected. `email` is the Driver column.
 */
export interface AssignedWorkOrder {
  readonly rideId: string
  readonly driverId: string
  /** The Vehicle the mail names. For "no longer yours" this is the one just released. */
  readonly vehicleId: string
  readonly email: string | null
  readonly locale: DisplayLocale
  readonly timeZone: string
  readonly pickupAt: Date
  readonly pickupPlace: string
  readonly dropOffPlace: string
  readonly guestName: string
  readonly tabla: string
  readonly passengerCount: number
  readonly luggageCount: number
  readonly childSeatCount: number
  readonly flightNumber: string | null
  readonly clientName: string
  readonly vehicleName: string | null
  readonly vehiclePlate: string
  readonly note: string | null
  readonly payment: PaymentMethod
  readonly price: string
}

const snapshotRows = z.object({
  rows: z.array(z.object({
    driverId: z.uuid(),
    email: z.string().nullable(),
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
    vehicleId: z.uuid(),
    note: z.string().nullable(),
    payment: paymentMethodSchema,
    price: z.union([z.string(), z.number()]),
    locale: z.enum(['hr', 'en']),
    timeZone: z.string().min(1),
  })),
})

/**
 * The Ride just assigned, with the names the work order has to state.
 * Clients, Locations, and Vehicles are read through their modules, by id
 * (ADR-0018). A missing row is a fixed error so a guest or a place cannot
 * ride out on a database message. The send itself waits until after commit.
 * `held` names the Driver and Vehicle a clear or a reassign removed.
 * After that update the Ride no longer stores them, and the mail still has to.
 */
export async function readAssignedWorkOrder(
  transaction: TenantTransaction,
  rideId: string,
  held?: { driverId: string, vehicleId: string },
): Promise<AssignedWorkOrder> {
  const driverId = held?.driverId ?? null
  const vehicleId = held?.vehicleId ?? null
  const selected = await hideDatabaseError(async () => {
    const parsed = snapshotRows.parse(await transaction.execute(sql`
      select
        d.id as "driverId",
        d.email,
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
        coalesce(${vehicleId}::uuid, r.vehicle_id) as "vehicleId",
        t.note,
        t.payment,
        t.price,
        s.default_locale as "locale",
        s.time_zone as "timeZone"
      from app.rides as r
      join app.transfers as t
        on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      join app.drivers as d
        on d.id = coalesce(${driverId}::uuid, r.driver_id) and d.tenant_id = r.tenant_id
      join app.tenant_settings as s
        on s.tenant_id = r.tenant_id
      where r.id = ${rideId}
    `))
    const row = parsed.rows[0]
    if (!row)
      throw new Error('missing')
    return row
  }, 'Work order read failed')
  // One client, one statement at a time. Parallel reads on this
  // transaction trip the driver.
  const client = await loadClient(transaction, selected.clientId)
  const pickup = await loadLocation(transaction, selected.startLocationId)
  const dropOff = await loadLocation(transaction, selected.endLocationId)
  const vehicle = await loadVehicle(transaction, selected.vehicleId)
  return {
    rideId,
    driverId: selected.driverId,
    vehicleId: selected.vehicleId,
    email: selected.email,
    locale: selected.locale,
    timeZone: selected.timeZone,
    pickupAt: toPickup(selected.pickupAt),
    pickupPlace: locationLabel(pickup),
    dropOffPlace: locationLabel(dropOff),
    guestName: selected.guestName,
    tabla: selected.tabla,
    passengerCount: selected.passengerCount,
    luggageCount: selected.luggageCount,
    childSeatCount: selected.childSeatCount,
    flightNumber: selected.flightNumber,
    clientName: client.name,
    vehicleName: vehicle.description,
    vehiclePlate: vehicle.registrationPlate,
    note: selected.note,
    payment: selected.payment,
    price: toPrice(selected.price),
  }
}

/**
 * One attempt, after the Ride has committed. The mail is composed here from
 * the snapshot read on that transaction, not stored on the outbox row.
 * A blank address sends nothing. A provider rejection leaves the outbox
 * entry `pending` (the caller records the attempt). The office outcome stays
 * `failed`, and the sentence says the send will be tried again. The
 * Resend-in-test error still aborts the process. The log names the entry,
 * the Ride, and the Driver. The provider message is dropped: it can echo
 * the address.
 */
export async function deliverAssignedWorkOrder(
  order: AssignedWorkOrder,
  mailer: Pick<Mailer, 'sendWorkOrder'>,
  log?: Logger,
  status: WorkOrderStatus = 'assigned',
  entryId?: string,
): Promise<WorkOrderNotice> {
  const address = order.email?.trim() ?? ''
  if (address === '')
    return { driverId: order.driverId, outcome: 'no_email' }
  const message = composeWorkOrder(order, status)
  // The same key on a retry of this snapshot is one send inside Resend's window.
  // A later attempt that composes different words gets its own key.
  const idempotencyKey = entryId === undefined ? undefined : workOrderIdempotencyKey(entryId, message)
  try {
    await mailer.sendWorkOrder({
      to: address,
      ...message,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    })
  }
  catch (error) {
    if (error instanceof ResendTransportError)
      throw error
    // A successful send logs nothing. The failure line is the only one,
    // and it waits until a provider rejection so a test process that
    // never booted can still assign.
    const logger = log ?? getLogger()
    logger.warn({
      event: 'work_order.email_failed',
      ...(entryId === undefined ? {} : { entryId }),
      rideId: order.rideId,
      driverId: order.driverId,
      err: { type: error instanceof Error ? error.name : 'Error' },
    })
    return { driverId: order.driverId, outcome: 'failed' }
  }
  return { driverId: order.driverId, outcome: 'sent' }
}

/** The outbox id recorded on the Ride transaction, or null when there was no address. */
export interface StagedWorkOrder {
  readonly entryId: string | null
  readonly order: AssignedWorkOrder
  readonly status: WorkOrderStatus
}

/**
 * The queue and the Tenant for the job that rides in the Ride transaction.
 * `now` is the clock. Tests pass a fixed instant. The office commands use the real one.
 */
export interface WorkOrderSchedule {
  readonly queue: JobQueue
  readonly context: TenantContext
  readonly now?: Date
}

/**
 * Record the work order on the Ride transaction. A blank email records nothing.
 * The row commits or rolls back with the Ride change. When `schedule` is set,
 * the same transaction enqueues the job for one minute later, so a process
 * that dies before the first attempt is picked up. That job is also the
 * second attempt when the first one fails.
 */
export async function stageWorkOrder(
  transaction: TenantTransaction,
  order: AssignedWorkOrder,
  status: WorkOrderStatus,
  schedule?: WorkOrderSchedule,
): Promise<StagedWorkOrder> {
  const now = schedule?.now ?? new Date()
  const startAfter = schedule === undefined ? null : new Date(now.getTime() + MAIL_RETRY_DELAYS_MS[0])
  const entryId = await recordWorkOrder(transaction, {
    rideId: order.rideId,
    driverId: order.driverId,
    // Only "no longer yours" needs the vehicle after the Ride has let it go.
    vehicleId: status === 'no_longer_yours' ? order.vehicleId : null,
    status,
    email: order.email,
  }, startAfter)
  if (entryId !== null && schedule !== undefined && startAfter !== null)
    await enqueueMailOutboxJob(schedule.queue, schedule.context, transaction, entryId, startAfter)
  return { entryId, order, status }
}

/**
 * The first attempt, after the Ride transaction has committed. The action
 * waits for it. The mail is the snapshot read on that transaction: a re-read
 * now would drop the vehicle a "no longer yours" mail must name. That
 * released vehicle id is already on the entry for the retry. Success marks
 * the entry sent. A rejection leaves it pending with the attempt counted.
 * A blank email never opened an entry.
 *
 * Noting the attempt has its own session. A failed statement aborts that
 * session, so the catch wraps the session, not only the update. The office
 * still receives the notice. The log is the entry id and nothing else.
 */
export async function deliverStagedWorkOrder(
  headers: Headers,
  staged: StagedWorkOrder,
  mailer: Pick<Mailer, 'sendWorkOrder'>,
  log?: Logger,
): Promise<WorkOrderNotice> {
  if (staged.entryId === null)
    return { driverId: staged.order.driverId, outcome: 'no_email' }
  const entryId = staged.entryId
  const notice = await deliverAssignedWorkOrder(staged.order, mailer, log, staged.status, entryId)
  // The Ride is already saved. Settle on its own session so a slow send
  // does not hold the Ride transaction, and a rejection still counts.
  try {
    await withTenantFromSession(headers, async ({ transaction }) => {
      await noteWorkOrderAttempt(transaction, entryId, notice.outcome === 'sent' ? 'sent' : 'pending')
    })
  }
  catch {
    const logger = log ?? getLogger()
    logger.warn({ event: 'mail_outbox.note_failed', entryId })
  }
  return notice
}

function toPickup(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()))
      return parsed
  }
  throw new Error('Work order read failed')
}
