import type { SQL } from 'drizzle-orm'
import type { Ride } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canMarkRideDone, RIDE_ACCEPTED_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { loadDriverLinkedToMember } from '../../drivers'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'

/** The body was not an empty object, or the path was not a Ride id. Nothing is written. */
export class MarkRideDoneInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'MarkRideDoneInputError'
  }
}

/**
 * Done is not reachable from this state with this copied flag, including
 * when a concurrent command already won. Nothing was written.
 */
export class RideNotFinishableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_finishable'

  constructor() {
    super('Conflict')
    this.name = 'RideNotFinishableError'
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
    partnerId: z.uuid().nullable(),
  })),
})

const doneRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('done'),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.boolean(),
  })),
})

/** A done Ride still has the Driver, the Vehicle, and the copied flag it had. */
type DoneRide = z.infer<typeof doneRows>['rows'][number]

/**
 * Closing a handed-off Ride clears the Partner. The check allows a Partner
 * only while the state is `handed_off`. The Driver and Vehicle were already
 * null. The audit keeps the Partner id in the driver slot.
 */
const handedOffDoneRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('done'),
    driverId: z.null(),
    vehicleId: z.null(),
    mustAccept: z.null(),
  })),
})

/**
 * Accepts an empty body and a Ride id. Any key, or a path that is not an id,
 * throws first, so the caller does not open a session.
 */
function parseMarkDone(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  // No body is the same empty object. Null and any key are not.
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new MarkRideDoneInputError()
  return id.data
}

/**
 * The linked Driver marks their own Ride done. The copied flag decides the
 * state: off from `assigned`, on from `accepted`. The Driver, the Vehicle,
 * and the flag stay. `ride.done` names this member. A Ride this Driver does
 * not hold is not found, and nothing is written.
 */
export async function markOwnRideDone(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<Ride> {
  const linked = await hideDatabaseError(
    () => loadDriverLinkedToMember(transaction, actorUserId),
    'Ride done failed',
  )
  const driver = linked.length === 1 ? linked[0] : undefined
  // A member with no Driver record cannot mark a Ride done. The same 404 as a missing Ride.
  if (!driver)
    throw new RideNotFoundError()

  const current = await lockRideForDone(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  // A handed-off Ride is office work. 403, not the 404 used when the Driver does not hold it.
  if (current.state === 'handed_off')
    throw new TenantAccessError(403)
  // A clear leaves no Driver. A reassignment leaves another Driver.
  // Both are hidden the same way a missing Ride is.
  if (current.driverId !== driver.id)
    throw new RideNotFoundError()
  if (!canMarkRideDone(current.state, current.mustAccept))
    throw new RideNotFinishableError()

  const updated = await writeDoneRide(transaction, rideId, driver.id)
  // The locked row was finishable. Zero rows means a concurrent command committed first.
  if (!updated)
    throw new RideNotFinishableError()

  await appendDone(transaction, actorUserId, updated.id, updated.driverId)
  return updated
}

/**
 * A dispatcher or an admin marks the Ride done. The same flag rule applies.
 * The Driver id is the Ride's, including when that Driver has no account.
 * A handed-off Ride is closed with no wait and no version bump. The Partner
 * is cleared so the check still holds, and `ride.done` stores that Partner
 * id in the driver slot. The caller has already required that role.
 */
export async function markRideDoneForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<Ride> {
  const current = await lockRideForDone(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  if (current.state === 'handed_off')
    return closeHandedOffDone(transaction, actorUserId, rideId, current.partnerId)
  // Unassigned has no Driver. Any other pair the flag rule refuses stays as it was.
  if (current.driverId === null || !canMarkRideDone(current.state, current.mustAccept))
    throw new RideNotFinishableError()

  const updated = await writeDoneRide(transaction, rideId, current.driverId)
  if (!updated)
    throw new RideNotFinishableError()

  await appendDone(transaction, actorUserId, updated.id, updated.driverId)
  return updated
}

async function closeHandedOffDone(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  partnerId: string | null,
): Promise<Ride> {
  if (partnerId === null)
    throw new RideNotFinishableError()
  const updated = handedOffDoneRows.parse(await runDoneStep(transaction, sql`
    update app.rides
    set state = 'done',
        partner_id = null
    where id = ${rideId}
      and state = 'handed_off'
      and partner_id = ${partnerId}
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
  if (!updated)
    throw new RideNotFinishableError()
  await appendDone(transaction, actorUserId, updated.id, partnerId)
  return updated
}

/**
 * The Driver or the office marks a Ride done. The body is parsed first, so a
 * key never opens a session. A driver marks only their own Ride. A dispatcher
 * or an admin marks any Ride in the Tenant. No mail is sent.
 */
export async function markRideDone(headers: Headers, rawRideId: unknown, rawBody: unknown): Promise<Ride> {
  const rideId = parseMarkDone(rawRideId, rawBody)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    if (actor.role === 'driver')
      return markOwnRideDone(transaction, actor.userId, rideId)
    if (actor.role === 'admin' || actor.role === 'dispatcher')
      return markRideDoneForOffice(transaction, actor.userId, rideId)
    throw new TenantAccessError(403)
  })
}

/** The Ride row this command will decide on. Missing means another Tenant, or no such Ride. */
async function lockRideForDone(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runDoneStep(transaction, sql`
    select id,
           state,
           driver_id as "driverId",
           vehicle_id as "vehicleId",
           must_accept as "mustAccept",
           partner_id as "partnerId"
    from app.rides
    where id = ${rideId}
    for update
  `)).rows[0]
}

/**
 * Sets `done` only while the Ride is still the pair the caller already
 * checked: `assigned` with the copied flag off, or `accepted` with the flag
 * on, and the Driver is the one already checked. The Driver, the Vehicle,
 * and the flag are not rewritten. Zero rows means a concurrent command won.
 */
async function writeDoneRide(
  transaction: TenantTransaction,
  rideId: string,
  driverId: string,
): Promise<DoneRide | undefined> {
  return doneRows.parse(await runDoneStep(transaction, sql`
    update app.rides
    set state = 'done'
    where id = ${rideId}
      and driver_id = ${driverId}
      and (
        (state = 'assigned' and must_accept is false)
        or (state = 'accepted' and must_accept is true)
      )
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
}

/** The done row stores ids and the field name. The actor is the person. A name is not a key. */
async function appendDone(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  driverId: string,
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.done',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId,
      // A handed-off close stores the Partner id in this slot. The row itself no longer has it.
      driverId,
      fields: [...RIDE_ACCEPTED_FIELDS],
    },
  }), 'Ride done failed')
}

/** Run one statement on this command. Every failure becomes a fixed message. */
function runDoneStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride done failed')
}
