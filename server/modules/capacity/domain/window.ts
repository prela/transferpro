import { occupiedEnd } from '../../../../shared'

/** The instants that place a Ride's occupied window. */
export interface RideTimes {
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/** The window opens at the pickup, so only a pickup change moves its start (ADR-0029). */
export function startMoves(before: RideTimes, after: RideTimes): boolean {
  return before.pickupAt.getTime() !== after.pickupAt.getTime()
}

/**
 * Whether the end moves under the Tenant duration. A cleared landing moves
 * it only when that landing was not already the pickup.
 */
export function endMoves(before: RideTimes, after: RideTimes, durationMinutes: number): boolean {
  return occupiedEnd(before.pickupAt, before.landingAt, durationMinutes).getTime()
    !== occupiedEnd(after.pickupAt, after.landingAt, durationMinutes).getTime()
}

export function sameLanding(before: RideTimes, after: RideTimes): boolean {
  if (before.landingAt === null || after.landingAt === null)
    return before.landingAt === after.landingAt
  return before.landingAt.getTime() === after.landingAt.getTime()
}
