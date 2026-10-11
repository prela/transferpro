import type { SQL } from 'drizzle-orm'
import type { AssignedRide, ChangeRideVehicle, ReassignRide, Ride, ScheduleClash } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { parseChangeRideVehicle, parseClearRide, parseReassignRide, RIDE_ASSIGNMENT_FIELDS, RIDE_VEHICLE_CHANGE_FIELDS, rideChangeAllowed } from '../../../../shared'
import { hideDatabaseError, loadAppEnv } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { driverMustAcceptForAssign } from '../../drivers'
import { mailerForApp, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { vehiclePresenceForAssign } from '../../vehicles'
import { RideNotFoundError, RideVehicleArchivedError } from './assign'
import { checkRideSchedule } from './ride-schedule'
import { deliverAssignedWorkOrder, readAssignedWorkOrder } from './work-order'

/**
 * The Ride is not `assigned` or `accepted`, including when a concurrent
 * command already moved it. Nothing was written.
 */
export class RideNotOpenError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_open'

  constructor() {
    super('Conflict')
    this.name = 'RideNotOpenError'
  }
}

/** The Vehicle is already the one on the Ride. Nothing was written. */
export class RideVehicleUnchangedError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_vehicle_unchanged'

  constructor() {
    super('Conflict')
    this.name = 'RideVehicleUnchangedError'
  }
}

/** The Driver is already the one on the Ride. A vehicle change is the other command. Nothing was written. */
export class RideSameDriverError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_same_driver'

  constructor() {
    super('Conflict')
    this.name = 'RideSameDriverError'
  }
}

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    state: z.string(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

const keptRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.enum(['assigned', 'accepted']),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.boolean(),
  })),
})

const clearedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('unassigned'),
    driverId: z.null(),
    vehicleId: z.null(),
    mustAccept: z.null(),
  })),
})

const reassignedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('assigned'),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.boolean(),
  })),
})

type LockedRide = z.infer<typeof lockedRows>['rows'][number]

/** The Driver and Vehicle the command took off the Ride. The mail still names them. */
interface ReleasedAssignment {
  readonly driverId: string
  readonly vehicleId: string
}

interface Delivery {
  mailer: Mailer
  logger?: Logger
}

/**
 * Change only the Vehicle. The Driver, the state, and the copied flag stay.
 * An `assigned` Ride stays `assigned`. An `accepted` Ride stays `accepted`.
 * `ride.vehicle_changed` names the actor and the field `vehicleId`. It does
 * not store a plate, a phone, or the must-accept value. This statement does
 * not read `app.drivers`. The caller has already required a dispatcher or an admin.
 */
export async function changeRideVehicle(
  transaction: TenantTransaction,
  actorUserId: string,
  input: ChangeRideVehicle,
): Promise<{ ride: Ride, relocationWarnings: ScheduleClash[] }> {
  const current = await lockOpenRide(transaction, input.rideId)
  if (current.vehicleId === input.vehicleId)
    throw new RideVehicleUnchangedError()

  const presence = await vehiclePresenceForAssign(transaction, input.vehicleId)
  if (presence === 'missing')
    throw new RideNotFoundError()
  if (presence === 'archived')
    throw new RideVehicleArchivedError()

  const relocationWarnings = await checkRideSchedule(transaction, {
    rideId: input.rideId,
    driverId: current.driverId,
    vehicleId: input.vehicleId,
    confirm: input.confirm === true,
  })

  const updated = keptRows.parse(await runStep(transaction, sql`
    update app.rides
    set vehicle_id = ${input.vehicleId}
    where id = ${input.rideId}
      and driver_id = ${current.driverId}
      and state in ('assigned', 'accepted')
      and vehicle_id is distinct from ${input.vehicleId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  if (!updated)
    throw new RideNotOpenError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.vehicle_changed',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: updated.driverId,
      vehicleId: updated.vehicleId,
      fields: [...RIDE_VEHICLE_CHANGE_FIELDS],
    },
  }), 'Ride vehicle change failed')
  return { ride: updated, relocationWarnings }
}

/**
 * Return an `assigned` or `accepted` Ride to `unassigned`. The Driver, the
 * Vehicle, and the copied flag are cleared together. `ride.cleared` names
 * the actor and the ids that were on the Ride. It does not store a plate,
 * a phone, or the must-accept value. The caller has already required a
 * dispatcher or an admin.
 */
export async function clearAssignedRide(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<{ ride: Ride, released: ReleasedAssignment }> {
  const current = await lockOpenRide(transaction, rideId)
  const updated = clearedRows.parse(await runStep(transaction, sql`
    update app.rides
    set state = 'unassigned',
        driver_id = null,
        vehicle_id = null,
        must_accept = null
    where id = ${rideId}
      and state in ('assigned', 'accepted')
      and driver_id = ${current.driverId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  if (!updated)
    throw new RideNotOpenError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.cleared',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: current.driverId,
      vehicleId: current.vehicleId,
      fields: [...RIDE_ASSIGNMENT_FIELDS],
    },
  }), 'Ride clear failed')
  return {
    ride: updated,
    released: { driverId: current.driverId, vehicleId: current.vehicleId },
  }
}

/**
 * Give an `assigned` or `accepted` Ride to another Driver and a Vehicle.
 * The Ride becomes `assigned`. The copied flag is that Driver's setting at
 * this call, not the flag the previous Driver had. `ride.reassigned` names
 * the actor and the new ids. It does not store a plate, a phone, the
 * must-accept value, or the previous Driver. The caller has already required
 * a dispatcher or an admin.
 */
export async function reassignAssignedRide(
  transaction: TenantTransaction,
  actorUserId: string,
  input: ReassignRide,
): Promise<{ ride: Ride, released: ReleasedAssignment, relocationWarnings: ScheduleClash[] }> {
  const current = await lockOpenRide(transaction, input.rideId)
  if (current.driverId === input.driverId)
    throw new RideSameDriverError()

  const driverFlag = await driverMustAcceptForAssign(transaction, input.driverId)
  if (driverFlag === null)
    throw new RideNotFoundError()

  const presence = await vehiclePresenceForAssign(transaction, input.vehicleId)
  if (presence === 'missing')
    throw new RideNotFoundError()
  if (presence === 'archived')
    throw new RideVehicleArchivedError()

  const relocationWarnings = await checkRideSchedule(transaction, {
    rideId: input.rideId,
    driverId: input.driverId,
    vehicleId: input.vehicleId,
    confirm: input.confirm === true,
  })

  const mustAccept = driverFlag
  const updated = reassignedRows.parse(await runStep(transaction, sql`
    update app.rides
    set state = 'assigned',
        driver_id = ${input.driverId},
        vehicle_id = ${input.vehicleId},
        must_accept = ${mustAccept}
    where id = ${input.rideId}
      and driver_id = ${current.driverId}
      and state in ('assigned', 'accepted')
      and driver_id is distinct from ${input.driverId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  if (!updated)
    throw new RideNotOpenError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.reassigned',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: updated.driverId,
      vehicleId: updated.vehicleId,
      fields: [...RIDE_ASSIGNMENT_FIELDS],
    },
  }), 'Ride reassignment failed')
  return {
    ride: updated,
    released: { driverId: current.driverId, vehicleId: current.vehicleId },
    relocationWarnings,
  }
}

function officeOnly(role: string): void {
  // These three commands are office work. A driver does none of them (ADR-0005).
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * Change only the Vehicle. The body is parsed first. A driver is 403.
 * The update and `ride.vehicle_changed` commit together. The current Driver
 * is mailed changed after that commit. A rejected send leaves the Vehicle
 * change in place and is not retried. Tests pass a mailer.
 */
export async function changeVehicle(headers: Headers, raw: unknown, delivery?: Delivery): Promise<AssignedRide> {
  const input = parseChangeRideVehicle(raw)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const changed = await changeRideVehicle(transaction, actor.userId, input)
    const order = await readAssignedWorkOrder(transaction, changed.ride.id)
    return { ride: changed.ride, order, relocationWarnings: changed.relocationWarnings }
  })
  const notice = await deliverAssignedWorkOrder(saved.order, mailerFrom(delivery), delivery?.logger, 'changed')
  return { ride: saved.ride, workOrders: [notice], relocationWarnings: saved.relocationWarnings }
}

/**
 * Clear the Driver and the Vehicle. The body is parsed first. A driver is 403.
 * The update and `ride.cleared` commit together. The Driver who lost the Ride
 * is mailed no longer yours after that commit, with no price. A rejected send
 * leaves the clear in place. Tests pass a mailer.
 */
export async function clearRide(headers: Headers, rawRideId: unknown, rawBody: unknown, delivery?: Delivery): Promise<AssignedRide> {
  const rideId = parseClearRide(rawRideId, rawBody)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const cleared = await clearAssignedRide(transaction, actor.userId, rideId)
    const order = await readAssignedWorkOrder(transaction, cleared.ride.id, cleared.released)
    return { ride: cleared.ride, order }
  })
  const notice = await deliverAssignedWorkOrder(saved.order, mailerFrom(delivery), delivery?.logger, 'no_longer_yours')
  return { ride: saved.ride, workOrders: [notice], relocationWarnings: [] }
}

/**
 * Reassign to another Driver and a Vehicle. The body is parsed first. A driver
 * is 403. The update and `ride.reassigned` commit together. After that commit
 * the new Driver is mailed assigned and the previous Driver is mailed no longer
 * yours. Each result is its own. A rejection of one does not skip the other
 * and does not undo the reassignment. Tests pass a mailer.
 */
export async function reassignRide(headers: Headers, raw: unknown, delivery?: Delivery): Promise<AssignedRide> {
  const input = parseReassignRide(raw)
  const saved = await withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const moved = await reassignAssignedRide(transaction, actor.userId, input)
    const next = await readAssignedWorkOrder(transaction, moved.ride.id)
    const previous = await readAssignedWorkOrder(transaction, moved.ride.id, moved.released)
    return { ride: moved.ride, next, previous, relocationWarnings: moved.relocationWarnings }
  })
  const mailer = mailerFrom(delivery)
  const workOrders = [
    await deliverAssignedWorkOrder(saved.next, mailer, delivery?.logger, 'assigned'),
    await deliverAssignedWorkOrder(saved.previous, mailer, delivery?.logger, 'no_longer_yours'),
  ]
  return { ride: saved.ride, workOrders, relocationWarnings: saved.relocationWarnings }
}

function mailerFrom(delivery?: Delivery): Mailer {
  return delivery?.mailer ?? mailerForApp(loadAppEnv())
}

async function lockOpenRide(transaction: TenantTransaction, rideId: string): Promise<LockedRide & { driverId: string, vehicleId: string }> {
  const current = lockedRows.parse(await runStep(transaction, sql`
    select id,
           state,
           driver_id as "driverId",
           vehicle_id as "vehicleId",
           must_accept as "mustAccept"
    from app.rides
    where id = ${rideId}
    for update
  `)).rows[0]
  if (!current)
    throw new RideNotFoundError()
  if (!rideChangeAllowed(current.state) || current.driverId === null || current.vehicleId === null)
    throw new RideNotOpenError()
  return { ...current, driverId: current.driverId, vehicleId: current.vehicleId }
}

function runStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride change failed')
}
