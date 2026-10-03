import { expect, it } from 'vitest'
import { formatInstant } from './format-instant'

// 15 Jan 2026 23:30 UTC is 16 Jan 00:30 in Europe/Zagreb (CET, UTC+1).
const winterUtc = new Date('2026-01-15T23:30:00.000Z')
// 15 Jul 2026 22:30 UTC is 16 Jul 00:30 in Europe/Zagreb (CEST, UTC+2).
const summerUtc = new Date('2026-07-15T22:30:00.000Z')

it('shows a UTC instant in the tenant time zone', () => {
  expect(formatInstant(winterUtc, 'Europe/Zagreb', 'hr')).toBe('16. 01. 2026. 00:30')
  expect(formatInstant(winterUtc, 'Europe/Zagreb', 'en')).toBe('16/01/2026, 00:30')
  expect(formatInstant(summerUtc, 'Europe/Zagreb', 'hr')).toBe('16. 07. 2026. 00:30')
  expect(formatInstant(winterUtc, 'UTC', 'en')).toBe('15/01/2026, 23:30')
})

it('refuses an invalid instant', () => {
  expect(() => formatInstant(new Date('not-a-time'), 'Europe/Zagreb', 'hr')).toThrow(RangeError)
})
