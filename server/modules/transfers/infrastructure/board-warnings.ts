import type { ScheduleRide, TransferDayRide } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { calendarDateInTimeZone, deriveBoardWarnings, emptyBoardWarnings, localDayBounds, WAIT_MINUTES_MAX } from '../../../../shared'
import { loadDriverDocumentExpiry } from '../../drivers'
import { rosteredDriversOnDates } from '../../roster'
import { loadVehicleDocumentExpiry } from '../../vehicles'

/**
 * How far a neighbour can sit from this operational day and still clash.
 * Transfer duration and relocation gap each stop at 1440 minutes. A stored
 * landing can push the occupied end past the pickup, so the upper bound
 * follows the latest landing on the listed Rides. A neighbour whose pickup
 * is before that window and whose landing is after it still occupies the
 * day, so that row is loaded too.
 */
const NEIGHBOUR_REACH_MS = WAIT_MINUTES_MAX * 2 * 60_000

const neighbourRows = z.object({
  rows: z.array(z.object({
    rideId: z.uuid(),
    driverId: z.uuid(),
    vehicleId: z.uuid(),
    pickupAt: z.unknown(),
    landingAt: z.unknown().nullable(),
  })),
})

/**
 * Fill warnings on a day list. Display only: no audit entry and no mail.
 * A neighbour on another operational day can be named and is not added
 * to the list. The Ride's own Vehicle is read even when it is archived.
 */
export async function applyBoardWarnings(
  transaction: TenantTransaction,
  role: string,
  rides: readonly TransferDayRide[],
  timeZone: string,
  day: string,
  startHour: number,
  transferDurationMinutes: number,
  relocationGapMinutes: number,
): Promise<TransferDayRide[]> {
  const occupying = rides.filter(ride => ride.state === 'assigned' || ride.state === 'accepted')
  if (occupying.length === 0)
    return rides.map(ride => ({ ...ride, warnings: emptyBoardWarnings() }))

  const driverIds = idsOf(occupying.map(ride => ride.driverId))
  const vehicleIds = idsOf(occupying.map(ride => ride.vehicleId))
  const pickupDates = occupying.map(ride => calendarDateInTimeZone(timeZone, new Date(ride.pickupAt)))
  // One session client. A parallel read on it fails with a query already in progress.
  const drivers = await loadDriverDocumentExpiry(transaction, role, driverIds)
  const vehicles = await loadVehicleDocumentExpiry(transaction, role, vehicleIds)
  const roster = await rosteredDriversOnDates(transaction, role, pickupDates)
  const others = await loadNeighbours(transaction, occupying, timeZone, day, startHour, driverIds, vehicleIds)
  const driverExpiry = new Map(drivers.map(row => [row.id, row]))
  const vehicleExpiry = new Map(vehicles.map(row => [row.id, row]))
  const rostered = new Map(roster.map(row => [`${row.rosterDate}:${row.vehicleId}`, row.driverId]))

  return rides.map((ride) => {
    const pickupDate = calendarDateInTimeZone(timeZone, new Date(ride.pickupAt))
    const driver = ride.driverId == null ? undefined : driverExpiry.get(ride.driverId)
    const vehicle = ride.vehicleId == null ? undefined : vehicleExpiry.get(ride.vehicleId)
    return {
      ...ride,
      warnings: deriveBoardWarnings({
        ride: {
          rideId: ride.rideId,
          state: ride.state,
          pickupAt: new Date(ride.pickupAt),
          landingAt: ride.landingAt == null ? null : new Date(ride.landingAt),
          driverId: ride.driverId,
          vehicleId: ride.vehicleId,
        },
        pickupDate,
        documents: {
          drivingLicenceExpiresOn: driver?.drivingLicenceExpiresOn ?? null,
          transportLicenceExpiresOn: driver?.transportLicenceExpiresOn ?? null,
          registrationExpiresOn: vehicle?.registrationExpiresOn ?? null,
          technicalInspectionExpiresOn: vehicle?.technicalInspectionExpiresOn ?? null,
          insuranceExpiresOn: vehicle?.insuranceExpiresOn ?? null,
        },
        rosteredDriverId: ride.vehicleId == null
          ? null
          : rostered.get(`${pickupDate}:${ride.vehicleId}`) ?? null,
        others,
        durationMinutes: transferDurationMinutes,
        gapMinutes: relocationGapMinutes,
      }),
    }
  })
}

async function loadNeighbours(
  transaction: TenantTransaction,
  occupying: readonly TransferDayRide[],
  timeZone: string,
  day: string,
  startHour: number,
  driverIds: readonly string[],
  vehicleIds: readonly string[],
): Promise<ScheduleRide[]> {
  if (driverIds.length === 0 && vehicleIds.length === 0)
    return []
  const bounds = localDayBounds(day, timeZone, startHour)
  let latestBasis = bounds.end.getTime()
  for (const ride of occupying) {
    const pickup = new Date(ride.pickupAt).getTime()
    const landing = ride.landingAt == null ? pickup : new Date(ride.landingAt).getTime()
    latestBasis = Math.max(latestBasis, pickup, landing)
  }
  const lower = new Date(bounds.start.getTime() - NEIGHBOUR_REACH_MS).toISOString()
  const upper = new Date(latestBasis + NEIGHBOUR_REACH_MS).toISOString()
  const driverMatch = driverIds.length === 0
    ? sql`false`
    : sql`r.driver_id in (${sql.join(driverIds.map(id => sql`${id}`), sql`, `)})`
  const vehicleMatch = vehicleIds.length === 0
    ? sql`false`
    : sql`r.vehicle_id in (${sql.join(vehicleIds.map(id => sql`${id}`), sql`, `)})`
  const selected = neighbourRows.parse(await transaction.execute(sql`
    select r.id as "rideId",
           r.driver_id as "driverId",
           r.vehicle_id as "vehicleId",
           t.pickup_at as "pickupAt",
           t.landing_at as "landingAt"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    where r.state in ('assigned', 'accepted')
      and r.driver_id is not null
      and r.vehicle_id is not null
      and (${driverMatch} or ${vehicleMatch})
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
  return selected.rows.map(row => ({
    rideId: row.rideId,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    pickupAt: toDate(row.pickupAt),
    landingAt: row.landingAt == null ? null : toDate(row.landingAt),
  }))
}

function idsOf(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((id): id is string => id !== null))]
}

function toDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime()))
      return parsed
  }
  throw new Error('Ride pickup is not a timestamp.')
}
