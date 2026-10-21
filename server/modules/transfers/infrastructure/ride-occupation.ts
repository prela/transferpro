import type { TenantTransaction } from '../../../core/index'
import type { OccupyingRide, RangeOccupationQuery, RideOccupationQuery } from '../../capacity'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'

/**
 * The transfers side of the capacity occupation port (ADR-0034). These are
 * the only reads of who is taken; capacity asks them through
 * `rideOccupation` and never reads a Ride table itself.
 */

const occupyingRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    partnerId: z.uuid().nullable(),
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

/**
 * The other Rides that occupy this Driver or this Vehicle: assigned and
 * accepted, including one already in progress. A handed-off Ride has neither,
 * so it is not in this answer. Done, no-show, cancelled, and unassigned do
 * not. The Ride being changed is left out.
 * No row is locked. The caller holds the Tenant capacity lock (ADR-0034),
 * so every other capacity write of this Tenant has either committed, and
 * is seen here, or has not started. A row lock here could also wait on a
 * command that already waits on the Tenant lock, and the two would deadlock.
 */
export async function readOccupyingRides(
  transaction: TenantTransaction,
  query: RideOccupationQuery,
): Promise<OccupyingRide[]> {
  const result = occupyingRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select r.id,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.partner_id as "partnerId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.id <> ${query.rideId}
      and r.state in ('assigned', 'accepted')
      and (r.driver_id = ${query.driverId} or r.vehicle_id = ${query.vehicleId})
  `), 'Ride schedule check failed'))
  return result.rows.map(row => toOccupyingRide(row))
}

/**
 * Assigned, accepted, and handed-off Rides of these Drivers, Vehicles, or
 * Partners, or of the whole Tenant, whose pickup or landing falls in
 * `[from, to)`, or whose pickup is before it and landing at or after its
 * end. A handed-off Ride is matched by its Partner id. Display reads use
 * this, so no row is locked.
 */
export async function readOccupationDuring(
  transaction: TenantTransaction,
  query: RangeOccupationQuery,
): Promise<OccupyingRide[]> {
  const lower = query.from.toISOString()
  const upper = query.to.toISOString()
  const leaveOut = query.leaveOut === undefined ? sql`` : sql`and r.id <> ${query.leaveOut}`
  const selected = occupyingRows.parse(await transaction.execute(sql`
    select r.id,
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           r.partner_id as "partnerId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where (
        (r.state in ('assigned', 'accepted') and r.driver_id is not null and r.vehicle_id is not null)
        or (r.state = 'handed_off' and r.partner_id is not null)
      )
      and ${resourceMatch(query.of)}
      ${leaveOut}
      and (
        (t.pickup_at >= ${lower} and t.pickup_at < ${upper})
        or (
          t.landing_at is not null
          and t.landing_at >= ${lower}
          and t.landing_at < ${upper}
        )
        or (
          t.pickup_at < ${lower}
          and t.landing_at is not null
          and t.landing_at >= ${upper}
        )
      )
    order by t.pickup_at, r.id
  `))
  return selected.rows.map(row => toOccupyingRide(row))
}

function resourceMatch(of: RangeOccupationQuery['of']) {
  if (of === 'tenant')
    return sql`true`
  const driverMatch = of.driverIds.length === 0
    ? sql`false`
    : sql`r.driver_id in (${sql.join(of.driverIds.map(id => sql`${id}`), sql`, `)})`
  const vehicleMatch = of.vehicleIds.length === 0
    ? sql`false`
    : sql`r.vehicle_id in (${sql.join(of.vehicleIds.map(id => sql`${id}`), sql`, `)})`
  const partnerMatch = of.partnerIds.length === 0
    ? sql`false`
    : sql`r.partner_id in (${sql.join(of.partnerIds.map(id => sql`${id}`), sql`, `)})`
  return sql`(${driverMatch} or ${vehicleMatch} or ${partnerMatch})`
}

function toOccupyingRide(row: z.infer<typeof occupyingRows>['rows'][number]): OccupyingRide {
  return {
    rideId: row.id,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    partnerId: row.partnerId,
    pickupAt: toInstantDate(row.pickupAt),
    landingAt: row.landingAt == null ? null : toInstantDate(row.landingAt),
  }
}

export function toInstantDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()))
      return parsed
  }
  throw new Error('Ride pickup is not a timestamp.')
}
