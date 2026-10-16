import type { DisplayLocale } from './display-locale'
import { isCalendarDate } from './date'

/**
 * "Idi na dan…" (ADR-0038). The Transfers board reads `?day=` as YYYY-MM-DD
 * only. The office also types the day the way it is written on screen:
 * `20.10.2026` in Croatian and `20/10/2026` in English, with or without
 * spaces, and with the trailing dot Croatian dates keep.
 * Anything else stays a Transfer search, including a guest name that
 * happens to contain a date.
 */
const officeDay = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})\.?$/

export function parseCommandDay(raw: string): string | null {
  const text = raw.trim()
  if (isCalendarDate(text))
    return text
  const match = officeDay.exec(text)
  if (!match)
    return null
  const day = match[1]?.padStart(2, '0')
  const month = match[2]?.padStart(2, '0')
  const year = match[3]
  const iso = `${year}-${month}-${day}`
  return isCalendarDate(iso) ? iso : null
}

/**
 * The same date order as {@link formatInstant}, without a clock.
 * The ISO value is already padded, so the string does not depend on ICU.
 */
export function formatCommandDay(iso: string, locale: DisplayLocale): string {
  if (!isCalendarDate(iso))
    throw new RangeError('Command day is not a calendar date.')
  const [year, month, day] = iso.split('-')
  if (locale === 'hr')
    return `${day}. ${month}. ${year}.`
  return `${day}/${month}/${year}`
}
