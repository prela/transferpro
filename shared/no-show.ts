import type { DisplayLocale } from './display-locale'
import type { RideState } from './transfer'
import { calendarDateInTimeZone } from './date'
import { formatInstant } from './format-instant'
import { clockLabel } from './live-refresh'

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
 * one is stored, and from the scheduled pickup when it is not. `until` is
 * the first instant the wait has elapsed, which is what "Nedolazak" names.
 * A landing or an airport mark that is already stored is what this call uses.
 */
export function noShowWaitBounds(clock: NoShowClock): { from: Date, until: Date } {
  const from = clock.airport && clock.landingAt !== null ? clock.landingAt : clock.pickupAt
  const minutes = clock.airport ? clock.airportWaitMinutes : clock.elsewhereWaitMinutes
  return { from, until: new Date(from.getTime() + minutes * MINUTE_MS) }
}

/** The Driver may mark a No-show once `until` is reached. The office is not gated here. */
export function noShowWaitElapsed(clock: NoShowClock, now: Date): boolean {
  return now.getTime() >= noShowWaitBounds(clock).until.getTime()
}

/**
 * The button names the window (ADR-0007). Both ends are the clock when they
 * fall on the same calendar day in the Tenant zone ("od 10:00 do 10:25").
 * A window that reaches the next day names each end with the full date.
 */
export function noShowWindowLabels(
  from: Date,
  until: Date,
  timeZone: string,
  locale: DisplayLocale,
): { from: string, until: string } {
  const sameDay = calendarDateInTimeZone(timeZone, from) === calendarDateInTimeZone(timeZone, until)
  const label = (instant: Date) => sameDay
    ? clockLabel(instant, timeZone, locale)
    : formatInstant(instant, timeZone, locale)
  return { from: label(from), until: label(until) }
}
