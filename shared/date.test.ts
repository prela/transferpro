import { expect, it } from 'vitest'
import { instantFromWallClock, localDayBounds, operationalDateInTimeZone } from './date'

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

it('keeps a 23:30 Zagreb pickup on the operational day that started at 05:00', () => {
  const pickup = instantFromWallClock('2026-10-07T23:30', 'Europe/Zagreb')
  const own = localDayBounds('2026-10-07', 'Europe/Zagreb')
  const next = localDayBounds('2026-10-08', 'Europe/Zagreb')
  expect(pickup >= own.start && pickup < own.end).toBe(true)
  expect(pickup >= next.start && pickup < next.end).toBe(false)
})

it('puts a pickup at 04:59 on the previous operational day and starts the new day at 05:00', () => {
  const before = instantFromWallClock('2026-10-08T04:59', 'Europe/Zagreb')
  const start = instantFromWallClock('2026-10-08T05:00', 'Europe/Zagreb')
  const previous = localDayBounds('2026-10-07', 'Europe/Zagreb')
  const next = localDayBounds('2026-10-08', 'Europe/Zagreb')
  expect(before >= previous.start && before < previous.end).toBe(true)
  expect(before >= next.start && before < next.end).toBe(false)
  expect(start.getTime()).toBe(previous.end.getTime())
  expect(start >= previous.start && start < previous.end).toBe(false)
  expect(start.getTime()).toBe(next.start.getTime())
  expect(start >= next.start && start < next.end).toBe(true)
})

it('lists a 00:30 Zagreb pickup on the previous operational day only', () => {
  const pickup = instantFromWallClock('2026-10-08T00:30', 'Europe/Zagreb')
  const previous = localDayBounds('2026-10-07', 'Europe/Zagreb')
  const calendar = localDayBounds('2026-10-08', 'Europe/Zagreb')
  expect(pickup >= previous.start && pickup < previous.end).toBe(true)
  expect(pickup >= calendar.start && pickup < calendar.end).toBe(false)
})

it('names the operational day by the date of its 05:00 start, including before 05:00', () => {
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T04:59', 'Europe/Zagreb'))).toBe('2026-10-07')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T00:30', 'Europe/Zagreb'))).toBe('2026-10-07')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T05:00', 'Europe/Zagreb'))).toBe('2026-10-08')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T12:00', 'Europe/Zagreb'))).toBe('2026-10-08')
})

it('breaks the 23-hour Zagreb night at local 05:00 on 29 March 2026', () => {
  // Clocks jump at 02:00, which is still the operational day that started on 28 March.
  const day = localDayBounds('2026-03-28', 'Europe/Zagreb')
  expect(day.end.getTime() - day.start.getTime()).toBe(23 * 60 * 60 * 1000)
  const late = instantFromWallClock('2026-03-29T04:59', 'Europe/Zagreb')
  const nextStart = instantFromWallClock('2026-03-29T05:00', 'Europe/Zagreb')
  const justBefore = new Date(day.start.getTime() - 1)
  expect(late >= day.start && late < day.end).toBe(true)
  expect(justBefore < day.start).toBe(true)
  expect(nextStart.getTime()).toBe(day.end.getTime())
  expect(nextStart < day.end).toBe(false)
  expect(operationalDateInTimeZone('Europe/Zagreb', late)).toBe('2026-03-28')
  expect(operationalDateInTimeZone('Europe/Zagreb', nextStart)).toBe('2026-03-29')
})

it('breaks the 25-hour Zagreb night at local 05:00 on 25 October 2026', () => {
  // The repeated hour is 02:00–03:00, still inside the operational day that started on 24 October.
  const day = localDayBounds('2026-10-24', 'Europe/Zagreb')
  expect(day.end.getTime() - day.start.getTime()).toBe(25 * 60 * 60 * 1000)
  const late = instantFromWallClock('2026-10-25T04:59', 'Europe/Zagreb')
  const firstRepeat = new Date('2026-10-25T00:30:00.000Z')
  const secondRepeat = instantFromWallClock('2026-10-25T02:30', 'Europe/Zagreb')
  const nextStart = instantFromWallClock('2026-10-25T05:00', 'Europe/Zagreb')
  expect(late >= day.start && late < day.end).toBe(true)
  expect(firstRepeat >= day.start && firstRepeat < day.end).toBe(true)
  expect(secondRepeat >= day.start && secondRepeat < day.end).toBe(true)
  expect(nextStart.getTime()).toBe(day.end.getTime())
  expect(nextStart < day.end).toBe(false)
  expect(operationalDateInTimeZone('Europe/Zagreb', late)).toBe('2026-10-24')
  expect(operationalDateInTimeZone('Europe/Zagreb', nextStart)).toBe('2026-10-25')
})

it('refuses a clock reading that is not a real minute', () => {
  expect(() => instantFromWallClock('2026-02-31T12:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06T24:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06 12:00', 'Europe/Zagreb')).toThrow(RangeError)
})
