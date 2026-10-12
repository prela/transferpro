import { z } from 'zod'
import { addCalendarDays, calendarDateInTimeZone } from './date'

/**
 * How often the schedule asks. The ask itself does not sleep.
 * ADR-0028: every 15 minutes, from 12 hours before pickup.
 */
export const FLIGHT_ASK_EVERY_MINUTES = 15

/** A pickup further ahead than this is not asked. The edge is included. */
export const FLIGHT_ASK_LEAD_MS = 12 * 60 * 60 * 1000

/**
 * The arrival has to be this close to the pickup. Further away stores nothing.
 * Exactly this far still matches. ADR-0028.
 */
export const FLIGHT_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000

const designatorPattern = /^([A-Z]{2,3}) ?(\d{1,4})$/i

/**
 * One flight designator: two or three letters and one to four digits, with
 * at most one space. `OU384`, `OU 384`, and `ou 384` share one key.
 * Anything else is a note and is not tracked. Letters are ASCII: `ß` is not
 * an airline code.
 */
export function flightDesignator(flightNumber: string | null): string | null {
  if (flightNumber === null)
    return null
  const match = designatorPattern.exec(flightNumber)
  if (!match)
    return null
  return `${match[1]!.toUpperCase()}${match[2]}`
}

export function sameFlightDesignator(left: string, right: string): boolean {
  const a = flightDesignator(left)
  const b = flightDesignator(right)
  return a !== null && a === b
}

/**
 * ADR-0028. A different flight designator throws away the landing stored for
 * the previous one, including a designator replaced by a note or cleared.
 * Spacing that still names the same designator (`OU384` and `OU 384`) clears
 * nothing. The same stored text clears nothing. A note that stays a note
 * (`VIP` to `meet at desk`) is not a designator change and clears nothing.
 * `VIP 2` is a designator (`VIP` plus `2`), so a note becoming that clears.
 */
export function flightNumberChangeClearsLanding(previous: string | null, next: string | null): boolean {
  if (previous === next)
    return false
  return flightDesignator(previous) !== flightDesignator(next)
}

/**
 * The pickup's calendar date in the Tenant zone, and the day on either side.
 * A landing just before midnight still sits next to a pickup just after.
 */
export function flightAskDates(pickupAt: Date, timeZone: string): [string, string, string] {
  const day = calendarDateInTimeZone(timeZone, pickupAt)
  return [addCalendarDays(day, -1), day, addCalendarDays(day, 1)]
}

export const flightStatusNames = ['expected', 'landed', 'cancelled', 'diverted'] as const

export type FlightStatusName = (typeof flightStatusNames)[number]

/**
 * One arrival the status port returned. The landing time stays empty until
 * the status is `landed`. An `expected` status keeps the estimate.
 */
export interface FlightArrival {
  readonly arrivalAirport: string
  readonly status: FlightStatusName
  readonly expectedArrival: Date | null
  readonly landedAt: Date | null
}

const flightArrivalSchema = z.object({
  arrivalAirport: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(flightStatusNames),
  expectedArrival: z.iso.datetime().nullable(),
  landedAt: z.iso.datetime().nullable(),
})

/**
 * The status port's result, checked here so a vendor shape cannot pass
 * through. `null` means the payload is not a list of arrivals. An empty
 * list is a real empty result, not a cancellation.
 */
export function parseFlightArrivals(value: unknown): FlightArrival[] | null {
  const parsed = z.array(flightArrivalSchema).safeParse(value)
  if (!parsed.success)
    return null
  return parsed.data.map(row => ({
    arrivalAirport: row.arrivalAirport,
    status: row.status,
    expectedArrival: row.expectedArrival === null ? null : new Date(row.expectedArrival),
    landedAt: row.landedAt === null ? null : new Date(row.landedAt),
  }))
}

export type FlightArrivalChoice
  = | { readonly kind: 'none' }
    | { readonly kind: 'tie' }
    | { readonly kind: 'elsewhere' }
    | { readonly kind: 'expected', readonly expectedArrival: Date }
    | { readonly kind: 'landed', readonly landedAt: Date, readonly expectedArrival: Date | null }

/**
 * How far an estimate has to move before the Driver is told. A shorter
 * change is still stored. Exactly this far counts, earlier or later.
 * ADR-0028.
 */
export const ARRIVAL_MOVED_MS = 15 * 60 * 1000

/**
 * What is already stored. `basis` is the last estimate the Driver was told,
 * or the first stored estimate when the Driver has been told nothing.
 * Both stay null until the first estimate is stored.
 */
export interface ExpectedArrivalMemory {
  readonly expectedArrival: Date | null
  readonly basis: Date | null
}

/** The write, and the movement to hand the work-order port, if there is one. */
export interface ExpectedArrivalUpdate {
  readonly expectedArrival: Date
  readonly basis: Date
  readonly moved: { readonly previous: Date, readonly next: Date } | null
}

/**
 * The instant this arrival is measured by. A landed flight uses the actual
 * time. Anything else uses the estimate.
 */
function arrivalInstant(arrival: FlightArrival): Date | null {
  if (arrival.status === 'landed' && arrival.landedAt !== null)
    return arrival.landedAt
  return arrival.expectedArrival
}

/**
 * Among arrivals within 6 hours of the pickup, keep the closest. Two at
 * that same distance store nothing. A closest arrival at another airport
 * is not a landing here.
 */
export function chooseFlightArrival(
  arrivals: readonly FlightArrival[],
  pickupAt: Date,
  pickupIata: string,
): FlightArrivalChoice {
  const pickupMs = pickupAt.getTime()
  const ranked: { arrival: FlightArrival, distance: number }[] = []
  for (const arrival of arrivals) {
    const instant = arrivalInstant(arrival)
    if (instant === null || Number.isNaN(instant.getTime()))
      continue
    const distance = Math.abs(instant.getTime() - pickupMs)
    if (distance > FLIGHT_MATCH_WINDOW_MS)
      continue
    ranked.push({ arrival, distance })
  }
  const closest = ranked[0]
  if (closest === undefined)
    return { kind: 'none' }
  let best = closest
  let ties = 1
  for (const item of ranked.slice(1)) {
    if (item.distance < best.distance) {
      best = item
      ties = 1
    }
    else if (item.distance === best.distance) {
      ties += 1
    }
  }
  if (ties > 1)
    return { kind: 'tie' }
  if (best.arrival.arrivalAirport !== pickupIata)
    return { kind: 'elsewhere' }
  if (best.arrival.status === 'landed' && best.arrival.landedAt !== null)
    return { kind: 'landed', landedAt: best.arrival.landedAt, expectedArrival: best.arrival.expectedArrival }
  // Cancelled and diverted are a later notice. An estimate on those is not stored here.
  if (best.arrival.status === 'expected' && best.arrival.expectedArrival !== null)
    return { kind: 'expected', expectedArrival: best.arrival.expectedArrival }
  return { kind: 'none' }
}

/**
 * Store every reported estimate. The first one tells nobody, even when a
 * Driver is already assigned. A later one is a movement when it is at least
 * 15 minutes from the basis. With no Driver the movement is stored and the
 * basis stays, so the next ask after assignment can hand it once.
 */
export function storeExpectedArrival(
  memory: ExpectedArrivalMemory,
  reported: Date,
  hasDriver: boolean,
): ExpectedArrivalUpdate {
  if (memory.basis === null) {
    return { expectedArrival: reported, basis: reported, moved: null }
  }
  const moved = Math.abs(reported.getTime() - memory.basis.getTime()) >= ARRIVAL_MOVED_MS
  if (!hasDriver || !moved) {
    return { expectedArrival: reported, basis: memory.basis, moved: null }
  }
  return {
    expectedArrival: reported,
    basis: reported,
    moved: { previous: memory.basis, next: reported },
  }
}

/** A landing time is an instant that has already happened. `now` is included. */
export function landingTimeInFuture(landingAt: Date, now: Date): boolean {
  return landingAt.getTime() > now.getTime()
}
