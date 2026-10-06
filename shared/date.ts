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

const wallClock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * A `YYYY-MM-DDTHH:mm` clock reading in an IANA zone, as a UTC instant.
 * The Transfer form collects the pickup in the Tenant time zone. The row
 * stores the instant. Two passes, because the first offset can sit on the
 * other side of a daylight-saving change.
 * A skipped hour is read one hour later; a repeated hour is read at the standard-time offset.
 */
export function instantFromWallClock(wall: string, timeZone: string): Date {
  const match = wallClock.exec(wall)
  if (!match)
    throw new RangeError('Wall time is not YYYY-MM-DDTHH:mm.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (!isCalendarDate(`${match[1]}-${match[2]}-${match[3]}`) || hour > 23 || minute > 59)
    throw new RangeError('Wall time is not a real clock time.')

  const utcMillis = Date.UTC(year, month - 1, day, hour, minute)
  let instant = new Date(utcMillis - zoneOffsetMs(timeZone, new Date(utcMillis)))
  instant = new Date(utcMillis - zoneOffsetMs(timeZone, instant))
  return instant
}

/**
 * Milliseconds to add to this UTC instant to reach the same clock reading
 * in the zone. `hourCycle: 'h23'` can report midnight as 24, which is the
 * next calendar day.
 */
function zoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find(item => item.type === type)
    if (!part)
      throw new RangeError(`Missing ${type} from the formatted instant.`)
    return Number(part.value)
  }
  let year = pick('year')
  let month = pick('month')
  let day = pick('day')
  let hour = pick('hour')
  if (hour === 24) {
    hour = 0
    const next = new Date(Date.UTC(year, month - 1, day))
    next.setUTCDate(next.getUTCDate() + 1)
    year = next.getUTCFullYear()
    month = next.getUTCMonth() + 1
    day = next.getUTCDate()
  }
  return Date.UTC(year, month - 1, day, hour, pick('minute'), pick('second')) - instant.getTime()
}
