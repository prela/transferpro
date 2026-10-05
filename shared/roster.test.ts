import { expect, it } from 'vitest'
import { calendarDateInTimeZone } from './date'
import { parseRosterDate, parseSetRoster, RosterInputError } from './roster'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const day = '2026-10-05'

it('reads today as the calendar date in the Tenant time zone', () => {
  // 22:30 UTC is still 5 October in UTC, and already 6 October in Zagreb (CEST, UTC+2).
  const instant = new Date('2026-10-05T22:30:00.000Z')
  expect(calendarDateInTimeZone('UTC', instant)).toBe('2026-10-05')
  expect(calendarDateInTimeZone('Europe/Zagreb', instant)).toBe('2026-10-06')
})

it('accepts one assignment or a clear, and refuses a plate, a name, or a non-date', () => {
  expect(parseSetRoster({ rosterDate: day, driverId, vehicleId })).toEqual({
    rosterDate: day,
    driverId,
    vehicleId,
  })
  expect(parseSetRoster({ rosterDate: day, driverId, vehicleId: null })).toEqual({
    rosterDate: day,
    driverId,
    vehicleId: null,
  })
  expect(parseRosterDate(day)).toBe(day)

  expect(() => parseSetRoster({
    rosterDate: day,
    driverId,
    vehicleId,
    registrationPlate: 'DU123AB',
  })).toThrow(RosterInputError)
  expect(() => parseSetRoster({
    rosterDate: day,
    driverId,
    vehicleId,
    name: 'Ana',
    phone: '+38591111',
  })).toThrow(RosterInputError)
  expect(() => parseSetRoster({ rosterDate: '2026-02-31', driverId, vehicleId })).toThrow(RosterInputError)
  expect(() => parseRosterDate('2026-02-31')).toThrow(RosterInputError)
  expect(() => parseRosterDate(['2026-10-05'])).toThrow(RosterInputError)
  expect(() => parseRosterDate(undefined)).toThrow(RosterInputError)
})
