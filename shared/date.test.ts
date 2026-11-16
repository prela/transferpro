import { expect, it } from 'vitest'
import { addCalendarDays, instantFromWallClock, localDayBounds, mondayOfWeek, operationalDateInTimeZone, suggestedPickupWall, wallClockInTimeZone, weekDates } from './date'

it('writes a Zagreb wall clock from a stored instant, in winter time', () => {
  // 15 January 2026, 09:30Z is 10:30 in Zagreb.
  const instant = new Date('2026-01-15T09:30:00.000Z')
  expect(wallClockInTimeZone('Europe/Zagreb', instant)).toBe('2026-01-15T10:30')
  expect(instantFromWallClock('2026-01-15T10:30', 'Europe/Zagreb').toISOString()).toBe(instant.toISOString())
})

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

it('makes hour 0 the calendar date, and a pickup at the chosen hour starts that operational day', () => {
  const midnight = instantFromWallClock('2026-10-08T00:00', 'Europe/Zagreb')
  const before = instantFromWallClock('2026-10-08T05:59', 'Europe/Zagreb')
  const atSix = instantFromWallClock('2026-10-08T06:00', 'Europe/Zagreb')
  const day = localDayBounds('2026-10-08', 'Europe/Zagreb', 0)
  const atSixDay = localDayBounds('2026-10-08', 'Europe/Zagreb', 6)
  const previousSix = localDayBounds('2026-10-07', 'Europe/Zagreb', 6)
  expect(day.start.toISOString()).toBe('2026-10-07T22:00:00.000Z')
  expect(midnight.getTime()).toBe(day.start.getTime())
  expect(operationalDateInTimeZone('Europe/Zagreb', midnight, 0)).toBe('2026-10-08')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-07T23:59', 'Europe/Zagreb'), 0)).toBe('2026-10-07')
  expect(before >= previousSix.start && before < previousSix.end).toBe(true)
  expect(before >= atSixDay.start && before < atSixDay.end).toBe(false)
  expect(atSix.getTime()).toBe(atSixDay.start.getTime())
  expect(atSix >= atSixDay.start && atSix < atSixDay.end).toBe(true)
  expect(operationalDateInTimeZone('Europe/Zagreb', before, 6)).toBe('2026-10-07')
  expect(operationalDateInTimeZone('Europe/Zagreb', atSix, 6)).toBe('2026-10-08')
})

it('starts a spring-forward morning one hour later when the hour is 02:00', () => {
  // 29 March 2026, 02:00 does not exist. The same rule as a pickup clock reads it as 03:00 CEST.
  const day = localDayBounds('2026-03-29', 'Europe/Zagreb', 2)
  expect(day.start.toISOString()).toBe('2026-03-29T01:00:00.000Z')
  const before = new Date(day.start.getTime() - 60 * 1000)
  expect(operationalDateInTimeZone('Europe/Zagreb', before, 2)).toBe('2026-03-28')
  expect(operationalDateInTimeZone('Europe/Zagreb', day.start, 2)).toBe('2026-03-29')
})

it('reads the repeated autumn hour at standard time when the hour is 02:00', () => {
  // 25 October 2026, 02:00 happens twice. The later one is CET (UTC+1), 01:00 UTC.
  const day = localDayBounds('2026-10-25', 'Europe/Zagreb', 2)
  expect(day.start.toISOString()).toBe('2026-10-25T01:00:00.000Z')
  const firstRepeat = new Date('2026-10-25T00:00:00.000Z')
  expect(firstRepeat < day.start).toBe(true)
  expect(operationalDateInTimeZone('Europe/Zagreb', firstRepeat, 2)).toBe('2026-10-24')
  expect(operationalDateInTimeZone('Europe/Zagreb', day.start, 2)).toBe('2026-10-25')
})

it('names the operational day by the date of its 05:00 start, including before 05:00', () => {
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T04:59', 'Europe/Zagreb'))).toBe('2026-10-07')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T00:30', 'Europe/Zagreb'))).toBe('2026-10-07')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T05:00', 'Europe/Zagreb'))).toBe('2026-10-08')
  expect(operationalDateInTimeZone('Europe/Zagreb', instantFromWallClock('2026-10-08T12:00', 'Europe/Zagreb'))).toBe('2026-10-08')
})

it('keeps noon on the previous operational day in the past at 04:55, 05:00, and 05:05', () => {
  // 20 October 2026 is still CEST, so local noon is 10:00Z.
  // e2e specs that need a past pickup on one operational day use this noon.
  const zone = 'Europe/Zagreb'
  const cases = [
    ['2026-10-20T04:55', '2026-10-18', '2026-10-18T10:00:00.000Z'],
    ['2026-10-20T05:00', '2026-10-19', '2026-10-19T10:00:00.000Z'],
    ['2026-10-20T05:05', '2026-10-19', '2026-10-19T10:00:00.000Z'],
  ] as const
  for (const [wall, day, iso] of cases) {
    const now = instantFromWallClock(wall, zone)
    const previous = addCalendarDays(operationalDateInTimeZone(zone, now), -1)
    const noon = instantFromWallClock(`${previous}T12:00`, zone)
    expect(previous).toBe(day)
    expect(noon.toISOString()).toBe(iso)
    expect(noon.getTime()).toBeLessThan(now.getTime())
    expect(operationalDateInTimeZone(zone, noon)).toBe(day)
  }
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

it('names the Monday of the week that holds a calendar date', () => {
  expect(mondayOfWeek('2026-10-12')).toBe('2026-10-12')
  expect(mondayOfWeek('2026-10-16')).toBe('2026-10-12')
  expect(mondayOfWeek('2026-10-18')).toBe('2026-10-12')
  expect(weekDates(mondayOfWeek('2026-10-16'))).toEqual([
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
  ])
})

it('refuses a clock reading that is not a real minute', () => {
  expect(() => instantFromWallClock('2026-02-31T12:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06T24:00', 'Europe/Zagreb')).toThrow(RangeError)
  expect(() => instantFromWallClock('2026-10-06 12:00', 'Europe/Zagreb')).toThrow(RangeError)
})

const zagreb = 'Europe/Zagreb'

it('suggests the shown day at noon during the operational day, before and after noon', () => {
  // 12 November 2026 is CET. 08:00 and 15:40 are both after the 05:00 start.
  const morning = instantFromWallClock('2026-11-12T08:00', zagreb)
  const afternoon = instantFromWallClock('2026-11-12T15:40', zagreb)
  expect(suggestedPickupWall('2026-11-12', morning, zagreb, 5)).toBe('2026-11-12T12:00')
  expect(suggestedPickupWall('2026-11-12', afternoon, zagreb, 5)).toBe('2026-11-12T12:00')
  // Another shown day keeps noon on that day. 12:00 may already have passed.
  expect(suggestedPickupWall('2026-11-14', afternoon, zagreb, 5)).toBe('2026-11-14T12:00')
})

it('suggests the next full hour on the next calendar date during the night window', () => {
  // Start hour 05:00. At 02:20 on 12 November the board shows 11 November.
  const now = instantFromWallClock('2026-11-12T02:20', zagreb)
  expect(operationalDateInTimeZone(zagreb, now, 5)).toBe('2026-11-11')
  expect(suggestedPickupWall('2026-11-11', now, zagreb, 5)).toBe('2026-11-12T03:00')
})

it('suggests the hour after an exact hour, never the hour that just started', () => {
  const now = instantFromWallClock('2026-11-12T02:00', zagreb)
  expect(suggestedPickupWall('2026-11-11', now, zagreb, 5)).toBe('2026-11-12T03:00')
})

it('suggests the start hour when that is the next full hour, on the next operational day', () => {
  // 04:20 → 05:00. 05:00 is the first moment of 12 November, and it is not in the past.
  const now = instantFromWallClock('2026-11-12T04:20', zagreb)
  expect(operationalDateInTimeZone(zagreb, now, 5)).toBe('2026-11-11')
  expect(suggestedPickupWall('2026-11-11', now, zagreb, 5)).toBe('2026-11-12T05:00')
})

it('suggests noon on another shown day during the night window, past or future', () => {
  const now = instantFromWallClock('2026-11-12T02:20', zagreb)
  expect(suggestedPickupWall('2026-11-10', now, zagreb, 5)).toBe('2026-11-10T12:00')
  expect(suggestedPickupWall('2026-11-20', now, zagreb, 5)).toBe('2026-11-20T12:00')
})

it('suggests noon on the shown day when the operational day starts at midnight', () => {
  // Hour 0 has no night window. 02:20 is already inside 12 November.
  const now = instantFromWallClock('2026-11-12T02:20', zagreb)
  expect(operationalDateInTimeZone(zagreb, now, 0)).toBe('2026-11-12')
  expect(suggestedPickupWall('2026-11-12', now, zagreb, 0)).toBe('2026-11-12T12:00')
  expect(suggestedPickupWall('2026-11-01', now, zagreb, 0)).toBe('2026-11-01T12:00')
})

it('suggests 03:00 on the spring-forward night, because 02:00 does not exist', () => {
  // 29 March 2026, 01:30 CET. Clocks jump from 02:00 to 03:00. The board shows 28 March.
  const now = instantFromWallClock('2026-03-29T01:30', zagreb)
  expect(operationalDateInTimeZone(zagreb, now, 5)).toBe('2026-03-28')
  expect(suggestedPickupWall('2026-03-28', now, zagreb, 5)).toBe('2026-03-29T03:00')
})

it('suggests a fall-back wall time the form will save after now', () => {
  // 25 October 2026. 02:30 happens twice. The first is 00:30 UTC, still on 24 October's operational day.
  const firstRepeat = new Date('2026-10-25T00:30:00.000Z')
  expect(operationalDateInTimeZone(zagreb, firstRepeat, 5)).toBe('2026-10-24')
  const duringRepeat = suggestedPickupWall('2026-10-24', firstRepeat, zagreb, 5)
  expect(duringRepeat).toBe('2026-10-25T03:00')
  expect(instantFromWallClock(duringRepeat, zagreb).getTime()).toBeGreaterThan(firstRepeat.getTime())

  // 01:30 CEST is 23:30 UTC on 24 October. The next wall hour is 02:00, and the form stores the later one.
  const beforeFold = new Date('2026-10-24T23:30:00.000Z')
  expect(wallClockInTimeZone(zagreb, beforeFold)).toBe('2026-10-25T01:30')
  const ambiguous = suggestedPickupWall('2026-10-24', beforeFold, zagreb, 5)
  expect(ambiguous).toBe('2026-10-25T02:00')
  expect(instantFromWallClock(ambiguous, zagreb).getTime()).toBeGreaterThan(beforeFold.getTime())
})
