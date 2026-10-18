import type { DisplayLocale } from './display-locale'
import type { PaymentMethod, RideState } from './transfer'
import { z } from 'zod'
import { addCalendarDays, instantFromWallClock, isCalendarDate, wallClockInTimeZone } from './date'

/**
 * Inclusive calendar days. A leap year is 366 days, so that year fits and
 * the next day does not. `from` after `to` is the same refusal.
 */
export const RIDE_EXPORT_MAX_DAYS = 366

/** The query was not two calendar dates inside the maximum range. Nothing is read. */
export class RideExportRangeError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'RideExportRangeError'
  }
}

/**
 * `from` and `to` are calendar dates, inclusive. A missing date, a reversed
 * range, or more than 366 days is the same fixed refusal. The caller parses
 * this before opening a session.
 */
export function parseRideExportQuery(raw: unknown): { from: string, to: string } {
  const parsed = z.object({
    from: z.string().refine(isCalendarDate),
    to: z.string().refine(isCalendarDate),
  }).safeParse(raw)
  if (!parsed.success)
    throw new RideExportRangeError()
  const { from, to } = parsed.data
  // `to` may be the 366th day (`from` plus 365). The next day is over the limit.
  if (from > to || addCalendarDays(from, RIDE_EXPORT_MAX_DAYS - 1) < to)
    throw new RideExportRangeError()
  return { from, to }
}

/**
 * Half-open UTC instants `[start, end)` for calendar dates in an IANA zone.
 * Midnight starts the day. This is not the operational day: a pickup at
 * 02:00 belongs to the calendar date of that clock, even when the board
 * lists it on the previous day.
 */
export function calendarDayBounds(from: string, to: string, timeZone: string): { start: Date, end: Date } {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to)
    throw new RangeError('Day is not a calendar date.')
  return {
    start: instantFromWallClock(`${from}T00:00`, timeZone),
    end: instantFromWallClock(`${addCalendarDays(to, 1)}T00:00`, timeZone),
  }
}

/** ASCII, so the download header needs no encoding. The dates are the range. */
export function rideExportFilename(from: string, to: string): string {
  return `rides-${from}-${to}.csv`
}

/** One Ride already resolved to the words the office sees. The caller orders by pickup. */
export interface RideExportRide {
  readonly pickupAt: string
  readonly pickup: string
  readonly dropOff: string
  readonly client: string
  readonly driver: string
  readonly plate: string
  /** Two-decimal EUR with a dot, as stored. The file writes a decimal comma. */
  readonly price: string
  readonly payment: PaymentMethod
  readonly state: RideState
}

const headers: Record<DisplayLocale, readonly string[]> = {
  hr: ['Datum', 'Vrijeme', 'Polazište', 'Odredište', 'Naručitelj', 'Vozač', 'Registarska oznaka', 'Cijena', 'Plaćanje', 'Stanje'],
  en: ['Date', 'Time', 'Pickup', 'Drop-off', 'Client', 'Driver', 'Registration plate', 'Price', 'Payment', 'Status'],
}

/** The same words as `transfers.payments` and `transfers.states` in both locale files. */
const payments: Record<DisplayLocale, Record<PaymentMethod, string>> = {
  hr: { cash: 'Gotovina', card: 'Kartica', invoice_to_agency: 'Račun agenciji' },
  en: { cash: 'Cash', card: 'Card', invoice_to_agency: 'Invoice to agency' },
}

const states: Record<DisplayLocale, Record<RideState, string>> = {
  hr: {
    'unassigned': 'Nedodijeljeno',
    'assigned': 'Dodijeljeno',
    'accepted': 'Prihvaćeno',
    'done': 'Obavljeno',
    'no-show': 'Nedolazak',
    'cancelled': 'Otkazano',
  },
  en: {
    'unassigned': 'Unassigned',
    'assigned': 'Assigned',
    'accepted': 'Accepted',
    'done': 'Done',
    'no-show': 'No-show',
    'cancelled': 'Cancelled',
  },
}

/**
 * Excel treats a text cell that starts with one of these as a formula.
 * A leading apostrophe keeps the characters as text. The price cell is
 * not passed through here.
 */
function guardFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

/** Quote when the cell holds the separator, a quote, or a line break. Quotes double. */
function quote(value: string): string {
  if (/[;"\r\n]/.test(value))
    return `"${value.replaceAll('"', '""')}"`
  return value
}

function textCell(value: string): string {
  return quote(guardFormula(value))
}

/**
 * Decimal comma, no thousands separator, no formula guard. A leading minus
 * stays a minus so Excel can still read a number. Stored fares are not negative.
 */
function priceCell(price: string): string {
  if (!/^-?\d+\.\d{2}$/.test(price))
    throw new RangeError('Price is not a two-decimal amount.')
  return price.replace('.', ',')
}

/**
 * `dd.mm.yyyy` and `HH:mm` in the Tenant zone. A repeated hour on a
 * daylight-saving night keeps the clock of that instant. A skipped hour
 * is not invented. `formatInstant` stays the screen writer (`16. 01. 2026.`
 * and `16/01/2026`); this file is the Excel shape, the same in both locales.
 */
function dateAndTime(pickupAt: string, timeZone: string): { date: string, time: string } {
  const instant = new Date(pickupAt)
  const wall = wallClockInTimeZone(timeZone, instant)
  const [date, time] = wall.split('T')
  if (date === undefined || time === undefined)
    throw new RangeError('Pickup wall time could not be read.')
  const [year, month, day] = date.split('-')
  if (year === undefined || month === undefined || day === undefined)
    throw new RangeError('Pickup wall time could not be read.')
  return { date: `${day}.${month}.${year}`, time }
}

/**
 * Croatian Excel: UTF-8 BOM, `;`, CRLF. Headers, states, and payment
 * methods follow the user's locale. The date column does not: it is
 * always `dd.mm.yyyy`. An empty list is the header only.
 */
export function buildRideExportCsv(
  rides: readonly RideExportRide[],
  timeZone: string,
  locale: DisplayLocale,
): string {
  const lines = [
    headers[locale].map(textCell).join(';'),
    ...rides.map((ride) => {
      const clock = dateAndTime(ride.pickupAt, timeZone)
      return [
        textCell(clock.date),
        textCell(clock.time),
        textCell(ride.pickup),
        textCell(ride.dropOff),
        textCell(ride.client),
        textCell(ride.driver),
        textCell(ride.plate),
        priceCell(ride.price),
        textCell(payments[locale][ride.payment]),
        textCell(states[locale][ride.state]),
      ].join(';')
    }),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
