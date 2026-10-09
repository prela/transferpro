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
 * The roster opens on it and expiring documents count from it. The board
 * does not: a Ride is listed on the operational day ({@link operationalDateInTimeZone}).
 * Parts are reassembled with a fixed calendar and digits so the string
 * does not depend on the ICU build.
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
 * Move a `YYYY-MM-DD` by whole calendar days. Month length and leap days
 * are included. A negative count steps backward.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  if (!isCalendarDate(isoDate) || !Number.isInteger(days))
    throw new RangeError('Not a calendar date.')
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Half-open UTC instants `[start, end)` for one operational day in an IANA zone.
 * `day` is the calendar date of the 05:00 start. `start` is local 05:00 of
 * that date. `end` is local 05:00 of the next date, so a pickup at exactly
 * 05:00 belongs to the new operational day and a pickup before 05:00 belongs
 * to the previous one. A daylight-saving night still breaks at local 05:00.
 * The bounds follow the zone, not a fixed 24 hours and not a `date` cast of
 * the stored instant, so the board can use the `(tenant_id, pickup_at)` index.
 * The roster and expiring documents do not call this.
 */
export function localDayBounds(day: string, timeZone: string): { start: Date, end: Date } {
  if (!isCalendarDate(day))
    throw new RangeError('Day is not a calendar date.')
  return {
    start: instantFromWallClock(`${day}T05:00`, timeZone),
    end: instantFromWallClock(`${addCalendarDays(day, 1)}T05:00`, timeZone),
  }
}

/**
 * The calendar date that names the operational day containing `instant`.
 * That date is the local date of the 05:00 that starts the interval. Before
 * local 05:00 the name is the previous calendar date. The board opens on
 * this date. The roster and expiring documents stay on {@link calendarDateInTimeZone}.
 */
export function operationalDateInTimeZone(timeZone: string, instant: Date): string {
  const calendar = calendarDateInTimeZone(timeZone, instant)
  if (instant.getTime() >= localDayBounds(calendar, timeZone).start.getTime())
    return calendar
  return addCalendarDays(calendar, -1)
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
