const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A calendar date, `YYYY-MM-DD`. No time and no zone: the column is a
 * `date`, and a later reminder reads that day as written.
 */
export function isCalendarDate(value: string): boolean {
  const match = calendarDate.exec(value)
  if (!match)
    return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/**
 * The calendar day of `instant` in an IANA time zone, `YYYY-MM-DD`.
 * The Tenant time zone decides which day "today" is: the roster opens on it
 * and expiring documents count from it. Parts are reassembled with a fixed
 * calendar and digits so the string does not depend on the ICU build.
 */
export function calendarDateInTimeZone(timeZone: string, instant: Date): string {
  if (Number.isNaN(instant.getTime()))
    throw new RangeError('Instant is not a valid time.')

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find(item => item.type === type)
    if (!part)
      throw new RangeError(`Missing ${type} from the formatted date.`)
    return part.value
  }
  const date = `${value('year')}-${value('month')}-${value('day')}`
  if (!isCalendarDate(date))
    throw new RangeError('Calendar date could not be read.')
  return date
}
