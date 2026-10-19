import type { ScheduleRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'

const occupyingRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

export interface OccupationQuery {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string
}

/**
 * The other Rides that occupy this Driver or this Vehicle: assigned and
 * accepted, including one already in progress. Done, no-show, cancelled,
 * and unassigned do not. The Ride being changed is left out.
 * No row is locked. The caller holds the Tenant capacity lock (ADR-0034),
 * so every other capacity write of this Tenant has either committed, and
 * is seen here, or has not started. A row lock here could also wait on a
 * command that already waits on the Tenant lock, and the two would deadlock.
 */
export async function readOccupyingRides(
  transaction: TenantTransaction,
  query: OccupationQuery,
): Promise<ScheduleRide[]> {
  const result = occupyingRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select r.id,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id <> ${query.rideId}
      and r.state in ('assigned', 'accepted')
      and (r.driver_id = ${query.driverId} or r.vehicle_id = ${query.vehicleId})
  `), 'Ride schedule check failed'))
  return result.rows.map(row => toScheduleRide(row))
}

export function toScheduleRide(row: {
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
