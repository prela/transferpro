import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'

it('reads a Zagreb wall clock as UTC, in summer time and in winter time', () => {
  // 6 October 2026 is still CEST, two hours ahead of UTC.
  expect(instantFromWallClock('2026-10-07T00:30', 'Europe/Zagreb').toISOString()).toBe('2026-10-06T22:30:00.000Z')
  // 15 January 2026 is CET, one hour ahead of UTC.
  expect(instantFromWallClock('2026-01-15T00:30', 'Europe/Zagreb').toISOString()).toBe('2026-01-14T23:30:00.000Z')
})

it('reads a skipped Zagreb hour one hour later and a repeated hour at standard time', () => {
  // 29 March 2026, 02:30 does not exist: clocks jump from 02:00 CET to 03:00 CEST.
  // The reading is stored as 03:30 CEST.
  expect(instantFromWallClock('2026-03-29T02:30', 'Europe/Zagreb').toISOString()).toBe('2026-03-29T01:30:00.000Z')
  // 25 October 2026, 02:30 happens twice. The later one is CET (UTC+1).
  expect(instantFromWallClock('2026-10-25T02:30', 'Europe/Zagreb').toISOString()).toBe('2026-10-25T01:30:00.000Z')
})

it('refuses a clock reading that is not a real minute', () => {
  expect(() => instantFromWallClock('2026-02-31T12:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06T24:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06 12:00', 'Europe/Zagreb')).toThrow(RangeError)
})
