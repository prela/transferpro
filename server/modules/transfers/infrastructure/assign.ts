import type { AssignRide, Ride, RosterVehicleSuggestion } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { assignTransitionAllowed, calendarDateInTimeZone, copiedMustAccept, RIDE_ASSIGNMENT_FIELDS, rideStateSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'
import { driverIsInTenant, driverMustAccept } from '../../drivers'
import { vehicleIdForDriverOnDate } from '../../roster'
import { loadTenantSettings } from '../../tenancy'
import { vehiclePresence } from '../../vehicles'

const rideStateRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    state: rideStateSchema,
  })),
})

const assignedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('assigned'),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.boolean(),
  })),
})

const pickupRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    pickupAt: z.unknown(),
  })),
})

/** The Ride, the Driver, or the Vehicle is not in this Tenant. Another Tenant's id looks the same. */
export class RideNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'RideNotFoundError'
  }
}

/** The Vehicle is archived. The plate is not in the message. */
export class RideVehicleArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_vehicle_archived'

  constructor() {
    super('Conflict')
    this.name = 'RideVehicleArchivedError'
  }
}

/**
 * The Ride is not `unassigned`, including when a concurrent assign already won.
 * Nothing was written.
 */
export class RideNotUnassignedError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_unassigned'

  constructor() {
    super('Conflict')
    this.name = 'RideNotUnassignedError'
  }
}

/**
 * Assign a Driver and a Vehicle to one unassigned Ride, and append
 * `ride.assigned` on this transaction. The entry names the actor and the
 * field names. It does not store a plate, a phone, or the must-accept value.
 * The copy is the Driver's setting at this call. A later change to the Driver
 * does not update this Ride: this statement does not join `app.drivers` on write.
 * Drivers have no archived or inactive column, so a Driver in this Tenant is assignable.
 * The caller has already required a dispatcher or an admin.
 */
export async function assignUnassignedRide(
  transaction: TenantTransaction,
  actorUserId: string,
  input: AssignRide,
): Promise<Ride> {
  const current = rideStateRows.parse(await transaction.execute(sql`
    select id, state
    from app.rides
    where id = ${input.rideId}
    for update
  `)).rows[0]
  if (!current)
    throw new RideNotFoundError()
  if (!assignTransitionAllowed(current.state))
    throw new RideNotUnassignedError()

  const driverFlag = await driverMustAccept(transaction, input.driverId)
  if (driverFlag === null)
    throw new RideNotFoundError()

  const presence = await vehiclePresence(transaction, input.vehicleId)
  if (presence === 'missing')
    throw new RideNotFoundError()
  if (presence === 'archived')
    throw new RideVehicleArchivedError()

  const mustAccept = copiedMustAccept(driverFlag)
  const updated = assignedRows.parse(await transaction.execute(sql`
    update app.rides
    set state = 'assigned',
        driver_id = ${input.driverId},
        vehicle_id = ${input.vehicleId},
        must_accept = ${mustAccept}
    where id = ${input.rideId}
      and state = 'unassigned'
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  // The locked row was unassigned. Zero rows means a concurrent assign committed first.
  if (!updated)
    throw new RideNotUnassignedError()

  await appendAuditEntry(transaction, {
    action: 'ride.assigned',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: updated.driverId,
      vehicleId: updated.vehicleId,
      fields: [...RIDE_ASSIGNMENT_FIELDS],
    },
  })
  return updated
}

/**
 * The Vehicle the roster gives this Driver on the Ride's pickup day, in the
 * Tenant time zone. Archived Vehicles are skipped. A missing roster row is
 * none. This read does not write a Ride, and a later roster change does not
 * either: the roster module has no ride table.
 */
export async function suggestRosterVehicle(
  transaction: TenantTransaction,
  rideId: string,
  driverId: string,
): Promise<RosterVehicleSuggestion> {
  const ride = pickupRows.parse(await transaction.execute(sql`
    select r.id, t.pickup_at as "pickupAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${rideId}
  `)).rows[0]
  if (!ride)
    throw new RideNotFoundError()

  if (!await driverIsInTenant(transaction, driverId))
    throw new RideNotFoundError()

  const settings = await loadTenantSettings(transaction)
  const day = calendarDateInTimeZone(settings.timeZone, toInstantDate(ride.pickupAt))
  const vehicleId = await vehicleIdForDriverOnDate(transaction, driverId, day)
  if (vehicleId === null)
    return { vehicleId: null }
  // A row already stored can name a Vehicle archived later. The suggestion skips it.
  if (await vehiclePresence(transaction, vehicleId) !== 'active')
    return { vehicleId: null }
  return { vehicleId }
}

/** node-pg may return a Date or a timestamp string. The day is read from the instant. */
function toInstantDate(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new Error('Ride pickup is not a timestamp.')
    return value
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('Ride pickup is not a timestamp.')
    return parsed
  }
  throw new Error('Ride pickup is not a timestamp.')
}
