import { expect, it } from 'vitest'
import {
  parseChangeUnavailability,
  parseRecordUnavailability,
  parseUnavailabilityResourceId,
  parseUnavailabilityWeek,
  UnavailabilityInputError,
  unavailabilityWeekRange,
  wholeDaysWindow,
  windowTouchesDate,
} from './unavailability'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const windowId = 'd1d1d1d1-1111-4111-8111-111111111111'
const zone = 'Europe/Zagreb'

it('reads a Driver window as UTC instants', () => {
  expect(parseRecordUnavailability({
    driverId,
    startsAt: '2026-10-20T08:00:00+02:00',
    endsAt: '2026-10-20T12:00:00.000Z',
  })).toEqual({
    resource: { kind: 'driver', id: driverId },
    startsAt: '2026-10-20T06:00:00.000Z',
    endsAt: '2026-10-20T12:00:00.000Z',
  })
})

it('reads a Vehicle window', () => {
  expect(parseRecordUnavailability({
    vehicleId,
    startsAt: '2026-10-20T06:00:00.000Z',
    endsAt: '2026-10-21T06:00:00.000Z',
  }).resource).toEqual({ kind: 'vehicle', id: vehicleId })
})

it('refuses a window for both, for neither, a reason, or a bad id', () => {
  const times = { startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T07:00:00.000Z' }
  for (const raw of [
    { driverId, vehicleId, ...times },
    { ...times },
    { driverId, ...times, reason: 'sick' },
    { driverId: 'not-a-uuid', ...times },
    null,
    'driver',
  ])
    expect(() => parseRecordUnavailability(raw)).toThrow(UnavailabilityInputError)
})

it('refuses an end at or before the start, and a time that is not an instant', () => {
  expect(() => parseRecordUnavailability({ driverId, startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T06:00:00.000Z' })).toThrow(UnavailabilityInputError)
  expect(() => parseRecordUnavailability({ driverId, startsAt: '2026-10-20T07:00:00.000Z', endsAt: '2026-10-20T06:00:00.000Z' })).toThrow(UnavailabilityInputError)
  expect(() => parseRecordUnavailability({ driverId, startsAt: '2026-10-20', endsAt: '2026-10-21' })).toThrow(UnavailabilityInputError)
  expect(() => parseRecordUnavailability({ driverId, startsAt: '2026-10-20T06:00', endsAt: '2026-10-20T07:00' })).toThrow(UnavailabilityInputError)
})

it('reads a change as the window id and two instants, and refuses a resource in the body', () => {
  expect(parseChangeUnavailability(windowId, {
    startsAt: '2026-10-20T06:00:00.000Z',
    endsAt: '2026-10-20T07:30:00.000Z',
  })).toEqual({ windowId, startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T07:30:00.000Z' })
  expect(() => parseChangeUnavailability('nope', { startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T07:00:00.000Z' })).toThrow(UnavailabilityInputError)
  expect(() => parseChangeUnavailability(windowId, { driverId, startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T07:00:00.000Z' })).toThrow(UnavailabilityInputError)
  expect(() => parseChangeUnavailability(windowId, { startsAt: '2026-10-20T08:00:00.000Z', endsAt: '2026-10-20T07:00:00.000Z' })).toThrow(UnavailabilityInputError)
})

it('reads a resource id and a roster week, and refuses anything else', () => {
  expect(parseUnavailabilityResourceId(driverId)).toBe(driverId)
  expect(() => parseUnavailabilityResourceId('x')).toThrow(UnavailabilityInputError)
  expect(parseUnavailabilityWeek('2026-10-19')).toBe('2026-10-19')
  expect(() => parseUnavailabilityWeek('2026-10-20')).toThrow(UnavailabilityInputError)
  expect(() => parseUnavailabilityWeek(['2026-10-19'])).toThrow(UnavailabilityInputError)
  expect(() => parseUnavailabilityWeek('2026-02-30')).toThrow(UnavailabilityInputError)
})

it('turns whole days into local midnight to the midnight after the last day, across a daylight saving change', () => {
  expect(wholeDaysWindow('2026-10-20', '2026-10-20', zone)).toEqual({
    startsAt: new Date('2026-10-19T22:00:00.000Z'),
    endsAt: new Date('2026-10-20T22:00:00.000Z'),
  })
  // Zagreb leaves summer time on 25 October 2026, so that day has 25 hours.
  expect(wholeDaysWindow('2026-10-24', '2026-10-25', zone)).toEqual({
    startsAt: new Date('2026-10-23T22:00:00.000Z'),
    endsAt: new Date('2026-10-25T23:00:00.000Z'),
  })
  expect(() => wholeDaysWindow('2026-10-21', '2026-10-20', zone)).toThrow(RangeError)
})

it('is the seven local days of the roster week', () => {
  expect(unavailabilityWeekRange('2026-10-19', zone)).toEqual({
    from: new Date('2026-10-18T22:00:00.000Z'),
    to: new Date('2026-10-25T23:00:00.000Z'),
  })
})

it('touches a roster day when any part of the half-open window falls on that local date', () => {
  const window = { startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T22:00:00.000Z' }
  expect(windowTouchesDate(window, '2026-10-20', zone)).toBe(true)
  // The window ends at local midnight, so the next day is free.
  expect(windowTouchesDate(window, '2026-10-21', zone)).toBe(false)
  expect(windowTouchesDate(window, '2026-10-19', zone)).toBe(false)
  expect(windowTouchesDate({ startsAt: '2026-10-19T21:59:00.000Z', endsAt: '2026-10-19T22:01:00.000Z' }, '2026-10-19', zone)).toBe(true)
  expect(windowTouchesDate({ startsAt: '2026-10-19T21:59:00.000Z', endsAt: '2026-10-19T22:01:00.000Z' }, '2026-10-20', zone)).toBe(true)
})
