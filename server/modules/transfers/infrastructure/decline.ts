import type { SQL } from 'drizzle-orm'
import type { Ride } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canDeclineRide, RIDE_ASSIGNMENT_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { loadDriverLinkedToMember } from '../../drivers'
import { TenantAccessError, withOfficeWrite } from '../../tenancy'
import { RideNotFoundError } from './assign'

/** The body was not an empty object, or the path was not a Ride id. Nothing is written. */
export class DeclineRideInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'DeclineRideInputError'
  }
}

/**
 * Decline is not reachable from this state, including when a concurrent
 * command already won. Nothing was written.
 */
export class RideNotDeclinableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_declinable'

  constructor() {
    super('Conflict')
    this.name = 'RideNotDeclinableError'
  }
}

const emptyBody = z.strictObject({})

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

const declinedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('unassigned'),
    driverId: z.null(),
    vehicleId: z.null(),
    mustAccept: z.null(),
  })),
})

/**
 * Accepts an empty body and a Ride id. Any key, or a path that is not an id,
 * throws first, so the caller does not open a session.
 */
function parseDecline(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  // No body is the same empty object. Null and any key are not.
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new DeclineRideInputError()
  return id.data
}

/**
 * The linked Driver declines their own Ride from `assigned` only. The Ride
 * returns to `unassigned`: the Driver, the Vehicle, and the copied flag are
 * cleared together. `ride.declined` names that Driver. A decline alert is
 * written in the same transaction. A Ride this Driver does not hold is not
 * found. `accepted` is refused. No mail is sent.
 */
async function declineOwnRide(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<Ride> {
  const linked = await hideDatabaseError(
    () => loadDriverLinkedToMember(transaction, actorUserId),
    'Ride decline failed',
  )
  const driver = linked.length === 1 ? linked[0] : undefined
  // A member with no Driver record cannot decline. The same 404 as a missing Ride.
  if (!driver)
    throw new RideNotFoundError()

  const current = await lockRideForDecline(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  // A clear leaves no Driver. A reassignment leaves another Driver.
  // Both are hidden the same way a missing Ride is.
  if (current.driverId !== driver.id || current.vehicleId === null)
    throw new RideNotFoundError()
  if (!canDeclineRide(current.state))
    throw new RideNotDeclinableError()

  const updated = await writeDeclinedRide(transaction, rideId, driver.id)
  // The locked row was assigned to this Driver. Zero rows means a concurrent command committed first.
  if (!updated)
    throw new RideNotDeclinableError()

  await recordDeclineAlert(transaction, updated.id, driver.id)
  await appendDeclined(transaction, actorUserId, updated.id, driver.id, current.vehicleId)
  return updated
}

/**
 * The Driver declines a Ride. The body is parsed first, so a key never opens
 * a session. Only a driver may decline. A dispatcher or an admin is 403:
 * the office takes a Ride back with clear, not with decline. No mail.
 */
export async function declineRide(headers: Headers, rawRideId: unknown, rawBody: unknown): Promise<Ride> {
  return withOfficeWrite(headers, rawBody, body => parseDecline(rawRideId, body), async ({ actor, transaction }, rideId) => {
    if (actor.role !== 'driver')
      throw new TenantAccessError(403)
    return declineOwnRide(transaction, actor.userId, rideId)
  })
}

/** The Ride row this command will decide on. Missing means another Tenant, or no such Ride. */
async function lockRideForDecline(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runDeclineStep(transaction, sql`
    select id,
           state,
           driver_id as "driverId",
           vehicle_id as "vehicleId",
           must_accept as "mustAccept"
    from app.rides
    where id = ${rideId}
    for update
  `)).rows[0]
}

/**
 * Returns the Ride to `unassigned` only while it is still `assigned` to the
 * Driver already checked. The Driver, the Vehicle, and the copied flag are
 * cleared together. Zero rows means a concurrent command won.
 */
async function writeDeclinedRide(
  transaction: TenantTransaction,
  rideId: string,
  driverId: string,
): Promise<Ride | undefined> {
  return declinedRows.parse(await runDeclineStep(transaction, sql`
    update app.rides
    set state = 'unassigned',
        driver_id = null,
        vehicle_id = null,
        must_accept = null
    where id = ${rideId}
      and driver_id = ${driverId}
      and state = 'assigned'
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
}

/** The board reads this row. It stores the Driver id, not the name. */
async function recordDeclineAlert(
  transaction: TenantTransaction,
  rideId: string,
  driverId: string,
): Promise<void> {
  await runDeclineStep(transaction, sql`
    insert into app.ride_alert (ride_id, driver_id, kind)
    values (${rideId}, ${driverId}, 'declined')
  `)
}

/** The declined row stores ids and the field names. The actor is the Driver. A name is not a key. */
async function appendDeclined(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  driverId: string,
  vehicleId: string,
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.declined',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId,
      driverId,
      vehicleId,
      fields: [...RIDE_ASSIGNMENT_FIELDS],
    },
  }), 'Ride decline failed')
}

/** Run one statement on this command. Every failure becomes a fixed message. */
function runDeclineStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride decline failed')
}
