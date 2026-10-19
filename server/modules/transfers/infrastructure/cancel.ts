import type { SQL } from 'drizzle-orm'
import type { CancelledRideResult, Ride } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { Mailer } from '../../tenancy'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canCancelRide, RIDE_ACCEPTED_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError, loadAppEnv } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { mailerForApp, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'
import { mailOutboxQueue } from './mail-outbox-worker'
import { deliverStagedWorkOrder, readAssignedWorkOrder, stageWorkOrder } from './work-order'

/** The body was not an empty object, or the path was not a Ride id. Nothing is written. */
export class CancelRideInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'CancelRideInputError'
  }
}

/**
 * Cancel is not reachable from this state, including when a concurrent
 * command already won. Nothing was written.
 */
export class RideNotCancellableError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_cancellable'

  constructor() {
    super('Conflict')
    this.name = 'RideNotCancellableError'
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

const cancelledRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('cancelled'),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
  })),
})

/** A cancelled Ride keeps the Driver, the Vehicle, and the copied flag it had. */
type CancelledRide = z.infer<typeof cancelledRows>['rows'][number]

/**
 * Accepts an empty body and a Ride id. Any key, or a path that is not an id,
 * throws first, so the caller does not open a session.
 */
function parseCancel(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  // No body is the same empty object. Null and any key are not.
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new CancelRideInputError()
  return id.data
}

/**
 * A dispatcher or an admin cancels the Ride from `unassigned`, `assigned`,
 * or `accepted`. The Driver, the Vehicle, and the copied flag stay, including
 * when there is no Driver. `ride.cancelled` names the office member.
 * A driver is refused before this runs. The mail is sent after this commits.
 */
export async function cancelRideForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
): Promise<Ride> {
  const current = await lockRideForCancel(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  if (!canCancelRide(current.state))
    throw new RideNotCancellableError()

  const updated = await writeCancelledRide(transaction, rideId)
  // The locked row was cancellable. Zero rows means a concurrent command committed first.
  if (!updated)
    throw new RideNotCancellableError()

  await appendCancelled(transaction, actorUserId, updated)
  return updated
}

/**
 * The office cancels a Ride. The body is parsed first, so a key never opens
 * a session. A dispatcher or an admin cancels any Ride in the Tenant. A
 * driver is refused and the Ride is unchanged. The current Driver is mailed
 * cancelled after the Ride commits, with no price. A Ride with no Driver
 * sends nothing. The outbox entry commits with the cancel. A rejection
 * leaves the Ride cancelled and the entry pending. Tests pass a mailer.
 * The address is not on the result.
 */
export async function cancelRide(
  headers: Headers,
  rawRideId: unknown,
  rawBody: unknown,
  delivery?: { mailer: Mailer, logger?: Logger },
): Promise<CancelledRideResult> {
  const rideId = parseCancel(rawRideId, rawBody)
  const queue = await mailOutboxQueue()
  const saved = await withTenantFromSession(headers, async ({ actor, context, transaction }) => {
    if (actor.role !== 'admin' && actor.role !== 'dispatcher')
      throw new TenantAccessError(403)
    const ride = await cancelRideForOffice(transaction, actor.userId, rideId)
    // An unassigned cancel has nobody to mail. The snapshot needs a Driver.
    if (ride.driverId === null)
      return { ride, staged: null }
    const order = await readAssignedWorkOrder(transaction, ride.id)
    const staged = await stageWorkOrder(transaction, order, 'cancelled', { queue, context })
    return { ride, staged }
  })
  if (saved.staged === null)
    return { ride: saved.ride, workOrders: [] }
  const mailer = delivery?.mailer ?? mailerForApp(loadAppEnv())
  const notice = await deliverStagedWorkOrder(headers, saved.staged, mailer, delivery?.logger)
  return { ride: saved.ride, workOrders: [notice] }
}

/** The Ride row this command will decide on. Missing means another Tenant, or no such Ride. */
async function lockRideForCancel(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runCancelStep(transaction, sql`
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
 * Sets `cancelled` only while the Ride is still `unassigned`, `assigned`, or
 * `accepted`. The Driver, the Vehicle, and the flag are not rewritten.
 * Zero rows means a concurrent command won.
 */
async function writeCancelledRide(
  transaction: TenantTransaction,
  rideId: string,
): Promise<CancelledRide | undefined> {
  return cancelledRows.parse(await runCancelStep(transaction, sql`
    update app.rides
    set state = 'cancelled'
    where id = ${rideId}
      and state in ('unassigned', 'assigned', 'accepted')
    returning
      id,
      transfer_id as "transferId",
      state,
      driver_id as "driverId",
      vehicle_id as "vehicleId",
      must_accept as "mustAccept"
  `)).rows[0]
}

/**
 * The cancelled row stores the Ride id, the Driver id when one was on the
 * Ride, and the field name. An unassigned Ride stores a null Driver id.
 * The actor is the person. A name is not a key.
 */
async function appendCancelled(
  transaction: TenantTransaction,
  actorUserId: string,
  updated: CancelledRide,
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.cancelled',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: updated.id,
      driverId: updated.driverId,
      fields: [...RIDE_ACCEPTED_FIELDS],
    },
  }), 'Ride cancel failed')
}

/** Run one statement on this command. Every failure becomes a fixed message. */
function runCancelStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride cancel failed')
}
