import type { DisplayLocale } from './display-locale'
import { addCalendarDays, isCalendarDate, operationalDateInTimeZone } from './date'

/**
 * One loaded day row, as far as search and the Client and Driver filters
 * need it. The Client reference is on the predicate because the within-day
 * search includes it (ADR-0038). The day read does not carry that column
 * yet, so the screen passes an empty string until it does. No migration.
 */
export interface TransferDaySearchRide {
  readonly guestName: string
  readonly flightNumber: string | null
  readonly clientReference: string | null
  readonly tabla: string
  readonly clientId: string
  readonly driverId: string | null
}

/**
 * Case-insensitive substring over the guest, the flight, the Client
 * reference, and the tabla. A blank query keeps every row. A missing
 * flight or reference is an empty field, not a match.
 */
export function transferDaySearchMatches(query: string, ride: TransferDaySearchRide): boolean {
  const needle = query.trim().toLocaleLowerCase('hr')
  if (needle === '')
    return true
  const fields = [ride.guestName, ride.flightNumber ?? '', ride.clientReference ?? '', ride.tabla]
  return fields.some(field => field.toLocaleLowerCase('hr').includes(needle))
}

/**
 * Empty id means that party is not narrowed. A Driver id does not match
 * an unassigned Ride, which has no Driver.
 */
export function transferDayPartyMatches(
  clientId: string,
  driverId: string,
  ride: Pick<TransferDaySearchRide, 'clientId' | 'driverId'>,
): boolean {
  if (clientId !== '' && ride.clientId !== clientId)
    return false
  if (driverId !== '' && ride.driverId !== driverId)
    return false
  return true
}

/**
 * Short weekday, Monday-first in the arrays only by index of `getUTCDay`
 * (Sunday is 0). Croatian names follow the ADR-0038 example ("sub").
 * These are calendar-day names, not instants, so they do not go through
 * `formatInstant`.
 */
const WEEKDAY: Record<DisplayLocale, readonly string[]> = {
  hr: ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const TOMORROW: Record<DisplayLocale, string> = {
  hr: 'sutra',
  en: 'tomorrow',
}

export interface SevenDayUnassignedPart {
  readonly date: string
  readonly count: number
  readonly name: string
}

/**
 * Unassigned Rides on the seven operational days after `operationalDay`.
 * Today is not in the note. A day with none is absent. The first of the
 * seven is "tomorrow" even when it is also a weekday. Later days use the
 * short weekday. No days means an empty list, and the screen shows no note.
 */
export function sevenDayUnassignedNote(
  rides: readonly { readonly pickupAt: string }[],
  operationalDay: string,
  timeZone: string,
  startHour: number,
  locale: DisplayLocale,
): SevenDayUnassignedPart[] {
  if (!isCalendarDate(operationalDay))
    throw new RangeError('Operational day is not a calendar date.')

  const first = addCalendarDays(operationalDay, 1)
  const last = addCalendarDays(operationalDay, 7)
  const counts = new Map<string, number>()
  for (const ride of rides) {
    const day = operationalDateInTimeZone(timeZone, new Date(ride.pickupAt), startHour)
    if (day < first || day > last)
      continue
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  const names = WEEKDAY[locale]
  return [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([date, count]) => ({
      date,
      count,
      name: date === first ? TOMORROW[locale] : names[weekdayIndex(date)] ?? '',
    }))
}

function weekdayIndex(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}
