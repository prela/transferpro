import type { RideState } from './transfer'

const MINUTE_MS = 60_000

/**
 * ADR-0006 and ADR-0007. The copied flag is the one stored on the Ride.
 * Off: a No-show is reachable from `assigned`. On: only from `accepted`.
 * The Driver and the office use the same pair. Every other pair, including
 * a second No-show, is refused.
 */
export function canMarkNoShow(state: RideState, mustAccept: boolean | null): boolean {
  return (state === 'assigned' && mustAccept === false) || (state === 'accepted' && mustAccept === true)
}

/**
 * The facts the wait is counted from, read at the attempt. The lengths are
 * the Tenant's current settings. They are not stored on the Ride.
 */
export interface NoShowClock {
  readonly airport: boolean
  readonly pickupAt: Date
  readonly landingAt: Date | null
  readonly airportWaitMinutes: number
  readonly elsewhereWaitMinutes: number
}

/**
 * ADR-0007. Elsewhere starts at the scheduled pickup and uses the elsewhere
 * wait. An airport uses the airport wait: from the recorded landing when
 * one is stored, and from the scheduled pickup when it is not. The wait has
 * elapsed at that instant, so the Driver may mark a No-show then. A landing
 * or an airport mark that is already stored is what this call uses.
 */
export function noShowWaitElapsed(clock: NoShowClock, now: Date): boolean {
  const start = clock.airport && clock.landingAt !== null ? clock.landingAt : clock.pickupAt
  const minutes = clock.airport ? clock.airportWaitMinutes : clock.elsewhereWaitMinutes
  return now.getTime() >= start.getTime() + minutes * MINUTE_MS
}
