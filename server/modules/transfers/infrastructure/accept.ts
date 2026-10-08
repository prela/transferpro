import type { SQL } from 'drizzle-orm'
import type { Ride } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { RIDE_ACCEPTED_FIELDS } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { loadDriverLinkedToMember } from '../../drivers'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'

/** The body was not an empty object, or the path was not a Ride id. Nothing is written. */
export class AcceptRideInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'AcceptRideInputError'
  }
}

/**
 * The Ride is not an `assigned` Ride with the copied flag on, including when
 * a concurrent accept already won. Nothing was written.
 */
export class RideNotAcceptableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_acceptable'

  constructor() {
    super('Conflict')
    this.name = 'RideNotAcceptableError'
  }
}

const emptyBody = z.strictObject({})

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    state: z.string(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

const acceptedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('accepted'),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.literal(true),
  })),
})

/**
 * Accepts an empty body and a Ride id. Any key, or a path that is not an id,
 * throws first, so the caller does not open a session. The Driver id is not
 * a field: it comes from the session later.
 */
function parseAcceptRide(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  // No body is the same empty object. Null and any key are not.
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new AcceptRideInputError()
  return id.data
}

/**
 * The Driver linked to this member accepts their own `assigned` Ride when
 * the copied flag is on. The Ride becomes `accepted`. The Driver, the Vehicle,
 * and the flag stay. `ride.accepted` is appended on this transaction.
 * The caller has already required the driver role.
 */
export async function acceptAssignedRide(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<Ride> {
  const linked = await hideDatabaseError(
    () => loadDriverLinkedToMember(transaction, actorUserId),
    'Ride accept failed',
  )
  const driver = linked.length === 1 ? linked[0] : undefined
  // A member with no Driver record cannot accept. The same 404 as a missing Ride.
  if (!driver)
    throw new RideNotFoundError()

  const current = lockedRows.parse(await runAcceptStep(transaction, sql`
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
  // Another Driver's Ride is hidden the same way a missing Ride is.
  // An unassigned Ride has no Driver, so it is not this case.
  if (current.driverId !== null && current.driverId !== driver.id)
    throw new RideNotFoundError()
  if (current.state !== 'assigned' || current.mustAccept !== true)
    throw new RideNotAcceptableError()

  const updated = acceptedRows.parse(await runAcceptStep(transaction, sql`
    update app.rides
    set state = 'accepted'
    where id = ${rideId}
      and state = 'assigned'
      and must_accept is true
      and driver_id = ${driver.id}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  // The locked row was acceptable. Zero rows means a concurrent accept committed first.
  if (!updated)
    throw new RideNotAcceptableError()

  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.accepted',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: updated.driverId,
      fields: [...RIDE_ACCEPTED_FIELDS],
    },
  }), 'Ride accept failed')
  return updated
}

/**
 * The Driver accepts their own Ride. The body is parsed first, so a key
 * never opens a session. Only the driver role may call this. The Driver id
 * is the session member's link, never a request field.
 */
export async function acceptRide(headers: Headers, rawRideId: unknown, rawBody: unknown): Promise<Ride> {
  const rideId = parseAcceptRide(rawRideId, rawBody)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    // Phone acceptance is a different route. A dispatcher or an admin is 403 here.
    if (actor.role !== 'driver')
      throw new TenantAccessError(403)
    return acceptAssignedRide(transaction, actor.userId, rideId)
  })
}

/** Run one statement on this accept. Every failure becomes a fixed message. */
function runAcceptStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride accept failed')
}
