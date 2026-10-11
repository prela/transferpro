import type { ScheduleClash, ScheduleRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { judgeSchedule } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadTenantSettings } from '../../tenancy'
import { RideNotFoundError } from './assign'

/**
 * The Driver or the Vehicle is already occupied on another Ride.
 * Nothing was written. `confirm: true` on the command is the only way through.
 */
export class RideOverlapError extends Error {
  readonly statusCode = 409
  readonly code = 'ride_overlap'

  constructor() {
    super('Conflict')
    this.name = 'RideOverlapError'
  }
}

const subjectRows = z.object({
  rows: z.array(z.object({
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

const occupyingRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

export interface ScheduleCheck {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
  readonly confirm: boolean
}

/**
 * Assigned and accepted Rides occupy, including one already in progress.
 * Done, no-show, cancelled, and unassigned do not. The Ride being changed
 * is excluded. A true overlap refuses the command unless `confirm` is set.
 * A tight relocation gap is returned and does not refuse.
 * The other rows are locked `for share` so a second command sees this one.
 */
export async function checkRideSchedule(
  transaction: TenantTransaction,
  input: ScheduleCheck,
): Promise<ScheduleClash[]> {
  const settings = await loadTenantSettings(transaction)
  const subject = subjectRows.parse(await run(transaction, sql`
    select t.pickup_at as "pickupAt", t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id = ${input.rideId}
  `)).rows[0]
  if (!subject)
    throw new RideNotFoundError()

  const occupying = occupyingRows.parse(await run(transaction, sql`
    select r.id,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id <> ${input.rideId}
      and r.state in ('assigned', 'accepted')
      and (r.driver_id = ${input.driverId} or r.vehicle_id = ${input.vehicleId})
    for share
  `)).rows.map(row => toScheduleRide(row))

  const verdict = judgeSchedule(
    toScheduleRide({
      id: input.rideId,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      pickupAt: subject.pickupAt,
      landingAt: subject.landingAt,
    }),
    occupying,
    settings.transferDurationMinutes,
    settings.relocationGapMinutes,
  )
  if (verdict.overlaps.length > 0 && !input.confirm)
    throw new RideOverlapError()
  return [...verdict.tightGaps]
}

function toScheduleRide(row: {
  id: string
  driverId: string
  vehicleId: string
  pickupAt: unknown
  landingAt: unknown
}): ScheduleRide {
  return {
    rideId: row.id,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    pickupAt: toInstant(row.pickupAt),
    landingAt: row.landingAt == null ? null : toInstant(row.landingAt),
  }
}

function toInstant(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()))
      return parsed
  }
  throw new Error('Ride pickup is not a timestamp.')
}

function run(transaction: TenantTransaction, query: ReturnType<typeof sql>): Promise<unknown> {
  return hideDatabaseError(() => transaction.execute(query), 'Ride schedule check failed')
}
