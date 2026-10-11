import type { DisplayLocale, PaymentMethod, WorkOrderNotice, WorkOrderStatus } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { composeWorkOrder, paymentMethodSchema } from '../../../../shared'
import { getLogger, hideDatabaseError } from '../../../core/index'
import { loadClient } from '../../clients'
import { loadLocation } from '../../locations'
import { ResendTransportError } from '../../tenancy'
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
    email: selected.email,
    locale: selected.locale,
    timeZone: selected.timeZone,
    pickupAt: toPickup(selected.pickupAt),
    pickupPlace: pickup.name,
    dropOffPlace: dropOff.name,
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
 * One attempt, after the Ride has committed. A blank address sends nothing.
 * A provider rejection is `failed` and is not retried. The Resend-in-test
 * error still aborts the process. The log names the Ride and the Driver.
 * The provider message is dropped: it can echo the address.
 */
export async function deliverAssignedWorkOrder(
  order: AssignedWorkOrder,
  mailer: Pick<Mailer, 'sendWorkOrder'>,
  log?: Logger,
  status: WorkOrderStatus = 'assigned',
): Promise<WorkOrderNotice> {
  const address = order.email?.trim() ?? ''
  if (address === '')
    return { driverId: order.driverId, outcome: 'no_email' }
  const message = composeWorkOrder(order, status)
  try {
    await mailer.sendWorkOrder({ to: address, ...message })
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
      rideId: order.rideId,
      driverId: order.driverId,
      err: { type: error instanceof Error ? error.name : 'Error' },
    })
    return { driverId: order.driverId, outcome: 'failed' }
  }
  return { driverId: order.driverId, outcome: 'sent' }
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
