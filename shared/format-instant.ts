import type { DisplayLocale } from './display-locale'
import { isCalendarDate } from './date'

/**
 * Day, month, year in the office order. Croatian keeps the trailing dot.
 * English is day/month/year. One place writes this, so a calendar date and
 * an instant cannot drift apart.
 */
function writtenDate(day: string, month: string, year: string, locale: DisplayLocale): string {
  if (locale === 'hr')
    return `${day}. ${month}. ${year}.`
  return `${day}/${month}/${year}`
}

/**
 * A calendar date, `YYYY-MM-DD`, with no clock and no zone. A command day
 * is not an instant, so {@link formatInstant} does not apply. The order is
 * the same one that function uses.
 */
export function formatCalendarDate(iso: string, locale: DisplayLocale): string {
  if (!isCalendarDate(iso))
    throw new RangeError('Calendar date is not valid.')
  const [year, month, day] = iso.split('-')
  if (year === undefined || month === undefined || day === undefined)
    throw new RangeError('Calendar date is not valid.')
  return writtenDate(day, month, year, locale)
}

/**
 * Display only. Pickup instants stay UTC; this turns one instant into wall
 * time in an IANA zone. The rest of the app should call this rather than
 * format dates on its own.
 */
export function formatInstant(instant: Date, timeZone: string, locale: DisplayLocale): string {
  if (Number.isNaN(instant.getTime()))
    throw new RangeError('Instant is not a valid time.')

  // en is en-GB: day/month/year. hr stays day. month. year.
  const intlLocale = locale === 'en' ? 'en-GB' : 'hr'
  const parts = new Intl.DateTimeFormat(intlLocale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find(item => item.type === type)
    if (!part)
      throw new RangeError(`Missing ${type} from the formatted instant.`)
    return part.value
  }

  const day = value('day')
  const month = value('month')
  const year = value('year')
  const hour = value('hour')
  const minute = value('minute')

  // Fixed order so the string does not depend on which ICU build is installed.
  const date = writtenDate(day, month, year, locale)
  if (locale === 'hr')
    return `${date} ${hour}:${minute}`
  return `${date}, ${hour}:${minute}`
}
