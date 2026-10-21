import type { SQL } from 'drizzle-orm'
import type { RecordedLanding } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canRecordLandingTime, landingTimeInFuture, recordedLandingSchema, RIDE_LANDING_FIELDS, rideStateSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { loadDriverLinkedToMember } from '../../drivers'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { RideNotFoundError } from './assign'
import { LandingTimeClosedError, LandingTimeInFutureError, recordLandingTime } from './flight-landing'

/** The body was not `{ landingAt }`, or the path was not a Ride id. Nothing is written. */
export class RecordLandingInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'RecordLandingInputError'
  }
}

/**
 * The Ride is `done`, `no-show`, `cancelled`, or `handed_off`. The stored time stays.
 * Nothing was written.
 */
export class RideLandingClosedError extends Error {
  readonly statusCode = 409
  readonly code = 'landing_time_closed'

  constructor() {
    super('Conflict')
    this.name = 'RideLandingClosedError'
  }
}

/**
 * The instant is still ahead of now. The stored time stays.
 * Nothing was written. `now` itself is allowed.
 */
export class RideLandingInFutureError extends Error {
  readonly statusCode = 409
  readonly code = 'landing_time_in_future'

  constructor() {
    super('Conflict')
    this.name = 'RideLandingInFutureError'
  }
}

const landingBody = z.strictObject({
  landingAt: z.iso.datetime().nullable(),
})

const lockedRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    transferId: z.uuid(),
    state: rideStateSchema,
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    mustAccept: z.boolean().nullable(),
    landingAt: z.unknown().nullable(),
  })),
})

type LockedRide = z.infer<typeof lockedRows>['rows'][number]

interface LandingRequest {
  readonly rideId: string
  readonly landingAt: Date | null
}

/**
 * Accepts `{ landingAt }` and a Ride id. `null` clears. Any other key, or a
 * path that is not an id, throws first, so the caller does not open a session.
 */
function parseLanding(rideId: unknown, body: unknown): LandingRequest {
  const id = z.uuid().safeParse(rideId)
  const payload = landingBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new RecordLandingInputError()
  return {
    rideId: id.data,
    landingAt: payload.data.landingAt === null ? null : new Date(payload.data.landingAt),
  }
}

function storedLanding(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  const instant = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(instant.getTime()))
    throw new Error('Landing time read failed')
  return instant
}

function sameLanding(stored: Date | null, next: Date | null): boolean {
  if (stored === null || next === null)
    return stored === next
  return stored.getTime() === next.getTime()
}

function toRecorded(row: LockedRide, landingAt: Date | null): RecordedLanding {
  return recordedLandingSchema.parse({
    id: row.id,
    transferId: row.transferId,
    state: row.state,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    mustAccept: row.mustAccept,
    landingAt: landingAt === null ? null : landingAt.toISOString(),
  })
}

/**
 * The Ride row this command will decide on. The Transfer row is locked too,
 * so a feed write waits. Missing means another Tenant, or no such Ride.
 */
async function lockRideForLanding(transaction: TenantTransaction, rideId: string) {
  return lockedRows.parse(await runLandingStep(transaction, sql`
    select r.id,
           r.transfer_id as "transferId",
           r.state,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.must_accept as "mustAccept",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t
      on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${rideId}
    for update of r, t
  `)).rows[0]
}

/**
 * Writes the landing time when it actually changes, then names the person.
 * The Ride state is not updated. A matching instant writes nothing.
 * A finished Ride is refused before the write.
 */
async function applyLanding(
  transaction: TenantTransaction,
  actorUserId: string,
  request: LandingRequest,
  now: Date,
  row: LockedRide,
): Promise<RecordedLanding> {
  if (!canRecordLandingTime(row.state))
    throw new RideLandingClosedError()

  const stored = storedLanding(row.landingAt)
  if (sameLanding(stored, request.landingAt))
    return toRecorded(row, stored)

  try {
    await recordLandingTime(transaction, request.rideId, request.landingAt, now)
  }
  catch (error) {
    if (error instanceof LandingTimeInFutureError)
      throw new RideLandingInFutureError()
    if (error instanceof LandingTimeClosedError)
      throw new RideLandingClosedError()
    throw error
  }

  // The actor is the person. The instant stays on the Transfer.
  await hideDatabaseError(() => appendAuditEntry(transaction, {
    action: 'ride.landing_recorded',
    actorUserId,
    subjectUserId: null,
    data: {
      rideId: row.id,
      driverId: row.driverId,
      fields: [...RIDE_LANDING_FIELDS],
    },
  }), 'Landing time failed')

  return toRecorded(row, request.landingAt)
}

/**
 * The linked Driver records or clears the landing time on their own unfinished
 * Ride. A Ride this Driver does not hold is not found, and nothing is written.
 */
async function recordForDriver(
  transaction: TenantTransaction,
  actorUserId: string,
  request: LandingRequest,
  now: Date,
): Promise<RecordedLanding> {
  const linked = await hideDatabaseError(
    () => loadDriverLinkedToMember(transaction, actorUserId),
    'Landing time failed',
  )
  const driver = linked.length === 1 ? linked[0] : undefined
  // A member with no Driver record cannot record a landing. The same 404 as a missing Ride.
  if (!driver)
    throw new RideNotFoundError()

  const current = await lockRideForLanding(transaction, request.rideId)
  if (!current || current.driverId !== driver.id)
    throw new RideNotFoundError()
  return applyLanding(transaction, actorUserId, request, now, current)
}

/**
 * A dispatcher or an admin records or clears the landing time on any unfinished
 * Ride in the Tenant, including one with no Driver. The caller has already
 * required that role.
 */
async function recordForOffice(
  transaction: TenantTransaction,
  actorUserId: string,
  request: LandingRequest,
  now: Date,
): Promise<RecordedLanding> {
  const current = await lockRideForLanding(transaction, request.rideId)
  if (!current)
    throw new RideNotFoundError()
  return applyLanding(transaction, actorUserId, request, now, current)
}

/**
 * The Driver or the office records or clears a landing time. The body is
 * parsed first, and a future instant is refused before a session opens.
 * A driver records only their own unfinished Ride. A dispatcher or an admin
 * records any unfinished Ride in the Tenant. The Ride stays in its state.
 * No mail is sent.
 */
export async function recordRideLanding(headers: Headers, rawRideId: unknown, rawBody: unknown): Promise<RecordedLanding> {
  const request = parseLanding(rawRideId, rawBody)
  const now = new Date()
  if (request.landingAt !== null && landingTimeInFuture(request.landingAt, now))
    throw new RideLandingInFutureError()
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    if (actor.role === 'driver')
      return recordForDriver(transaction, actor.userId, request, now)
    if (actor.role === 'admin' || actor.role === 'dispatcher')
      return recordForOffice(transaction, actor.userId, request, now)
    throw new TenantAccessError(403)
  })
}

/** Run one statement on this command. Every failure becomes a fixed message. */
function runLandingStep(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Landing time failed')
}
