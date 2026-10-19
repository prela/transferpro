import { WAIT_MINUTES_MAX } from '../../../../shared'

/**
 * How far a neighbour can sit from this operational day and still clash.
 * Transfer duration and relocation gap each stop at 1440 minutes. A stored
 * landing can push the occupied end past the pickup, so the upper bound
 * follows the latest landing on the listed Rides. The occupation port also
 * returns a neighbour whose pickup is before the range and whose landing
 * is after it, because it still occupies the day.
 */
const NEIGHBOUR_REACH_MS = WAIT_MINUTES_MAX * 2 * 60_000

/** The time range the board asks the occupation port about. */
export function boardOccupationRange(
  day: { readonly start: Date, readonly end: Date },
  rides: readonly { readonly pickupAt: Date, readonly landingAt: Date | null }[],
): { from: Date, to: Date } {
  let latestBasis = day.end.getTime()
  for (const ride of rides) {
    const pickup = ride.pickupAt.getTime()
    const landing = ride.landingAt === null ? pickup : ride.landingAt.getTime()
    latestBasis = Math.max(latestBasis, pickup, landing)
  }
  return {
    from: new Date(day.start.getTime() - NEIGHBOUR_REACH_MS),
    to: new Date(latestBasis + NEIGHBOUR_REACH_MS),
  }
}
