import type { DisplayLocale } from './display-locale'

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
  if (locale === 'hr')
    return `${day}. ${month}. ${year}. ${hour}:${minute}`
  return `${day}/${month}/${year}, ${hour}:${minute}`
}
