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
