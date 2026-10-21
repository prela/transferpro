import type { SQL } from 'drizzle-orm'
import type { Ride } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canCloseHandedOffRide, canMarkNoShow, noShowWaitElapsed, RIDE_ACCEPTED_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { loadDriverLinkedToMember } from '../../drivers'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'

/** The body was not an empty object, or the path was not a Ride id. Nothing is written. */
export class MarkNoShowInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'MarkNoShowInputError'
  }
}

/**
 * A No-show is not reachable from this state with this copied flag, including
 * when a concurrent command already won. Nothing was written.
 */
export class RideNotNoShowError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_not_no_show'

  constructor() {
    super('Conflict')
    this.name = 'RideNotNoShowError'
  }
}

/**
 * The Driver marked a No-show before the wait elapsed. The Ride is unchanged.
 * The office is not refused for this: they may mark it early.
 */
export class NoShowTooEarlyError extends Error {
  readonly statusCode = 409
  readonly code = 'no_show_too_early'

  constructor() {
    super('Conflict')
    this.name = 'NoShowTooEarlyError'
  }
}

const emptyBody = z.strictObject({})

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
    partnerId: z.uuid().nullable(),
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
    airportMark: z.boolean(),
  })),
})

type LockedRide = z.infer<typeof lockedRows>['rows'][number]

const noShowRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('no-show'),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    mustAccept: z.boolean(),
  })),
})

/** A No-show still has the Driver, the Vehicle, and the copied flag it had. No fee is stored. */
type NoShowRide = z.infer<typeof noShowRows>['rows'][number]

/**
 * Closing a handed-off Ride clears the Partner. The audit stores that
 * Partner id in the driver slot. The close is allowed before the wait.
 * After the wait the action is `ride.no_show`, and before it `ride.no_show_early`,
 * the same pair an office No-show already uses.
 */
const handedOffNoShowRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: z.literal('no-show'),
    driverId: z.null(),
    vehicleId: z.null(),
    mustAccept: z.null(),
  })),
})

/**
 * Accepts an empty body and a Ride id. Any key, or a path that is not an id,
 * throws first, so the caller does not open a session.
 */
function parseMarkNoShow(rideId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(rideId)
  // No body is the same empty object. Null and any key are not.
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new MarkNoShowInputError()
  return id.data
}

/**
 * The linked Driver marks their own Ride a No-show, only after the wait.
 * The copied flag decides the state. The Driver, the Vehicle, and the flag
 * stay. `ride.no_show` names this member. A Ride this Driver does not hold
 * is not found, and nothing is written.
 */
export async function markOwnNoShow(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  now: Date,
): Promise<Ride> {
  const linked = await hideDatabaseError(
    () => loadDriverLinkedToMember(transaction, actorUserId),
    'Ride no-show failed',
  )
  const driver = linked.length === 1 ? linked[0] : undefined
  // A member with no Driver record cannot mark a No-show. The same 404 as a missing Ride.
  if (!driver)
    throw new RideNotFoundError()

  const current = await lockRideForNoShow(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  // A handed-off Ride is office work. 403, not the 404 used when the Driver does not hold it.
  if (canCloseHandedOffRide(current.state))
    throw new TenantAccessError(403)
  // A clear leaves no Driver. A reassignment leaves another Driver.
  // Both are hidden the same way a missing Ride is.
  if (current.driverId !== driver.id)
    throw new RideNotFoundError()
  if (!canMarkNoShow(current.state, current.mustAccept))
    throw new RideNotNoShowError()
  if (!await waitElapsed(transaction, current, now))
    throw new NoShowTooEarlyError()

  const updated = await writeNoShowRide(transaction, rideId, driver.id)
  // The locked row was markable. Zero rows means a concurrent command committed first.
  if (!updated)
    throw new RideNotNoShowError()

  await appendNoShow(transaction, actorUserId, updated.id, updated.driverId, 'ride.no_show')
  return updated
}

/**
 * A dispatcher or an admin marks the Ride a No-show. The same flag rule
 * applies, including before the wait. The Driver id is the Ride's, including
 * when that Driver has no account. After the wait the action is `ride.no_show`.
 * Before it, `ride.no_show_early`. Either way the actor is this member.
 * The caller has already required that role.
 */
export async function markNoShowForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  now: Date,
): Promise<Ride> {
  const current = await lockRideForNoShow(transaction, rideId)
  if (!current)
    throw new RideNotFoundError()
  if (canCloseHandedOffRide(current.state))
    return closeHandedOffNoShow(transaction, actorUserId, current, now)
  // Unassigned has no Driver. Any other pair the flag rule refuses stays as it was.
  if (current.driverId === null || !canMarkNoShow(current.state, current.mustAccept))
    throw new RideNotNoShowError()

  const elapsed = await waitElapsed(transaction, current, now)
  const updated = await writeNoShowRide(transaction, rideId, current.driverId)
  if (!updated)
    throw new RideNotNoShowError()

  await appendNoShow(transaction, actorUserId, updated.id, updated.driverId, elapsed ? 'ride.no_show' : 'ride.no_show_early')
  return updated
}

async function closeHandedOffNoShow(
  transaction: TenantTransaction,
  actorUserId: string,
  current: LockedRide,
  now: Date,
): Promise<Ride> {
  const partnerId = current.partnerId
  if (partnerId === null)
    throw new RideNotNoShowError()
  // Allowed before the wait. The action is the same pair the office already uses.
  const elapsed = await waitElapsed(transaction, current, now)
  const updated = handedOffNoShowRows.parse(await runNoShowStep(transaction, sql`
    update app.rides
    set state = 'no-show',
        partner_id = null
    where id = ${current.id}
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
    throw new RideNotNoShowError()
  await appendNoShow(transaction, actorUserId, updated.id, partnerId, elapsed ? 'ride.no_show' : 'ride.no_show_early')
  return updated
}

/**
 * The Driver or the office marks a Ride a No-show. The body is parsed first,
 * so a key never opens a session. A driver marks only their own Ride, and
 * only after the wait. A dispatcher or an admin marks any Ride in the Tenant,
 * including before the wait. No fee is stored. No mail is sent.
 */
export async function markNoShow(headers: Headers, rawRideId: unknown, rawBody: unknown): Promise<Ride> {
  const rideId = parseMarkNoShow(rawRideId, rawBody)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    const now = new Date()
    if (actor.role === 'driver')
      return markOwnNoShow(transaction, actor.userId, rideId, now)
    if (actor.role === 'admin' || actor.role === 'dispatcher')
      return markNoShowForOffice(transaction, actor.userId, rideId, now)
    throw new TenantAccessError(403)
  })
}

/** The Ride and the Transfer this command will decide on. Missing means another Tenant, or no such Ride. */
async function lockRideForNoShow(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runNoShowStep(transaction, sql`
    select r.id,
           r.transfer_id as "transferId",
           r.state,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept",
           r.partner_id as "partnerId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt",
           t.airport_mark as "airportMark"
    from app.rides as r
    join app.transfers as t
      on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${rideId}
    for update of r, t
  `)).rows[0]
}

/**
 * The Tenant's current waits, and the Transfer's pickup, landing, and airport
 * mark as they are locked. A change that committed before this lock is what
 * this attempt uses.
 */
async function waitElapsed(transaction: TenantTransaction, current: LockedRide, now: Date): Promise<boolean> {
  const settings = await hideDatabaseError(
    () => loadTenantSettings(transaction),
    'Ride no-show failed',
  )
  return noShowWaitElapsed({
    airport: current.airportMark,
    pickupAt: storedInstant(current.pickupAt),
    landingAt: storedInstantOrEmpty(current.landingAt),
    airportWaitMinutes: settings.airportWaitMinutes,
    elsewhereWaitMinutes: settings.elsewhereWaitMinutes,
  }, now)
}

/** Sets `no-show` only while the pair the caller checked is still stored. The price is not a column here. */
async function writeNoShowRide(
  transaction: TenantTransaction,
  rideId: string,
  driverId: string,
): Promise<NoShowRide | undefined> {
  return noShowRows.parse(await runNoShowStep(transaction, sql`
    update app.rides
    set state = 'no-show'
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

/** The row stores ids and the field name. The action says whether the office closed it early. A fee is not a key. */
async function appendNoShow(
  transaction: TenantTransaction,
  actorUserId: string,
  rideId: string,
  driverId: string,
  action: 'ride.no_show' | 'ride.no_show_early',
): Promise<void> {
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action,
    actorUserId,
    subjectUserId: null,
    data: {
      rideId,
      // A handed-off close stores the Partner id in this slot. The row itself no longer has it.
      driverId,
      fields: [...RIDE_ACCEPTED_FIELDS],
    },
  }), 'Ride no-show failed')
}

function storedInstant(value: unknown): Date {
  const instant = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(instant.getTime()))
    throw new Error('No-show read failed')
  return instant
}

function storedInstantOrEmpty(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  return storedInstant(value)
}

/** Run one statement on this command. Every failure becomes a fixed message. */
function runNoShowStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride no-show failed')
}
