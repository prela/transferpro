import { expect, it } from 'vitest'
import { calendarDateInTimeZone } from './date'
import { parseRosterDate, parseSetRoster, planRosterCopy, RosterInputError } from './roster'

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

const ana = 'a1a1a1a1-1111-4111-8111-111111111111'
const marko = 'a2a2a2a2-2222-4222-8222-222222222222'
const van = 'v1v1v1v1-1111-4111-8111-111111111111'
const car = 'v2v2v2v2-2222-4222-8222-222222222222'
const thisWeek = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
] as const

it('copies last week onto empty cells only', () => {
  const plan = planRosterCopy({
    driverIds: [ana, marko],
    thisWeekDates: thisWeek,
    lastWeek: [
      { driverId: ana, rosterDate: '2026-10-05', vehicleId: van },
      { driverId: marko, rosterDate: '2026-10-06', vehicleId: car },
    ],
    thisWeek: [],
    archivedVehicleIds: [],
  })

  expect(plan.writes).toEqual([
    { driverId: ana, rosterDate: '2026-10-12', vehicleId: van },
    { driverId: marko, rosterDate: '2026-10-13', vehicleId: car },
  ])
  expect(plan.skipped).toEqual([])
})

it('does not overwrite a cell that already has a Vehicle', () => {
  const plan = planRosterCopy({
    driverIds: [ana],
    thisWeekDates: thisWeek,
    lastWeek: [
      { driverId: ana, rosterDate: '2026-10-05', vehicleId: van },
      { driverId: ana, rosterDate: '2026-10-06', vehicleId: car },
    ],
    thisWeek: [
      { driverId: ana, rosterDate: '2026-10-12', vehicleId: car },
    ],
    archivedVehicleIds: [],
  })

  expect(plan.writes).toEqual([
    { driverId: ana, rosterDate: '2026-10-13', vehicleId: car },
  ])
  expect(plan.skipped).toEqual([])
})

it('skips an archived Vehicle and a Vehicle already given that day', () => {
  const plan = planRosterCopy({
    driverIds: [ana, marko],
    thisWeekDates: thisWeek,
    lastWeek: [
      { driverId: ana, rosterDate: '2026-10-05', vehicleId: van },
      { driverId: marko, rosterDate: '2026-10-06', vehicleId: car },
    ],
    thisWeek: [
      { driverId: marko, rosterDate: '2026-10-12', vehicleId: van },
    ],
    archivedVehicleIds: [car],
  })

  expect(plan.writes).toEqual([])
  expect(plan.skipped).toEqual([
    { driverId: ana, rosterDate: '2026-10-12', vehicleId: van, reason: 'vehicleGiven' },
    { driverId: marko, rosterDate: '2026-10-13', vehicleId: car, reason: 'archivedVehicle' },
  ])
})
