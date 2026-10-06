import { expect, it } from 'vitest'
import { instantFromWallClock, localDayBounds } from './date'

it('reads a Zagreb wall clock as UTC, in summer time and in winter time', () => {
  // 6 October 2026 is still CEST, two hours ahead of UTC.
  expect(instantFromWallClock('2026-10-07T00:30', 'Europe/Zagreb').toISOString()).toBe('2026-10-06T22:30:00.000Z')
  // 15 January 2026 is CET, one hour ahead of UTC.
  expect(instantFromWallClock('2026-01-15T00:30', 'Europe/Zagreb').toISOString()).toBe('2026-01-14T23:30:00.000Z')
})

it('reads a skipped Zagreb hour one hour later on 29 March', () => {
  // 29 March 2026, 02:30 does not exist: clocks jump from 02:00 CET to 03:00 CEST.
  // The reading is stored as 03:30 CEST.
  expect(instantFromWallClock('2026-03-29T02:30', 'Europe/Zagreb').toISOString()).toBe('2026-03-29T01:30:00.000Z')
})

it('reads a repeated Zagreb hour at standard time on 25 October', () => {
  // 25 October 2026, 02:30 happens twice. The later one is CET (UTC+1).
  expect(instantFromWallClock('2026-10-25T02:30', 'Europe/Zagreb').toISOString()).toBe('2026-10-25T01:30:00.000Z')
})

it('keeps a 23:30 Zagreb pickup on its own day', () => {
  const pickup = instantFromWallClock('2026-10-07T23:30', 'Europe/Zagreb')
  const own = localDayBounds('2026-10-07', 'Europe/Zagreb')
  const next = localDayBounds('2026-10-08', 'Europe/Zagreb')
  expect(pickup >= own.start && pickup < own.end).toBe(true)
  expect(pickup >= next.start && pickup < next.end).toBe(false)
})

it('gives a pickup at local midnight to the new Zagreb day', () => {
  const midnight = instantFromWallClock('2026-10-08T00:00', 'Europe/Zagreb')
  const previous = localDayBounds('2026-10-07', 'Europe/Zagreb')
  const next = localDayBounds('2026-10-08', 'Europe/Zagreb')
  expect(midnight.getTime()).toBe(previous.end.getTime())
  expect(midnight >= previous.start && midnight < previous.end).toBe(false)
  expect(midnight.getTime()).toBe(next.start.getTime())
  expect(midnight >= next.start && midnight < next.end).toBe(true)
})

it('covers the 23-hour Zagreb day on 29 March 2026 and nothing past local midnight', () => {
  const day = localDayBounds('2026-03-29', 'Europe/Zagreb')
  expect(day.end.getTime() - day.start.getTime()).toBe(23 * 60 * 60 * 1000)
  const late = instantFromWallClock('2026-03-29T23:30', 'Europe/Zagreb')
  const nextMidnight = instantFromWallClock('2026-03-30T00:00', 'Europe/Zagreb')
  const justBefore = new Date(day.start.getTime() - 1)
  expect(late >= day.start && late < day.end).toBe(true)
  expect(justBefore < day.start).toBe(true)
  expect(nextMidnight.getTime()).toBe(day.end.getTime())
  expect(nextMidnight < day.end).toBe(false)
})

it('covers the 25-hour Zagreb day on 25 October 2026 and nothing past local midnight', () => {
  const day = localDayBounds('2026-10-25', 'Europe/Zagreb')
  expect(day.end.getTime() - day.start.getTime()).toBe(25 * 60 * 60 * 1000)
  const late = instantFromWallClock('2026-10-25T23:30', 'Europe/Zagreb')
  const firstRepeat = new Date('2026-10-25T00:30:00.000Z')
  const nextMidnight = instantFromWallClock('2026-10-26T00:00', 'Europe/Zagreb')
  expect(late >= day.start && late < day.end).toBe(true)
  expect(firstRepeat >= day.start && firstRepeat < day.end).toBe(true)
  expect(nextMidnight.getTime()).toBe(day.end.getTime())
  expect(nextMidnight < day.end).toBe(false)
})

it('refuses a clock reading that is not a real minute', () => {
  expect(() => instantFromWallClock('2026-02-31T12:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06T24:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06 12:00', 'Europe/Zagreb')).toThrow(RangeError)
})
