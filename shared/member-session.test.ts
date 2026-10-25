import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { createOfficeIdleClock, DRIVER_HELD_SESSION_MS, DRIVER_WARNING_LEAD_MS, driverSessionBanners, memberSessionCapMs, OFFICE_IDLE_MS, OFFICE_SESSION_MS, OFFICE_WARNING_LEAD_MS, officeSessionWarning, rideHoldsDriverSession } from './member-session'

const signedIn = new Date('2026-10-25T06:00:00.000Z')

it('caps an office session at twelve hours and a held driver session at sixteen', () => {
  expect(memberSessionCapMs('admin', false)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('dispatcher', true)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('driver', false)).toBe(OFFICE_SESSION_MS)
  expect(memberSessionCapMs('driver', true)).toBe(DRIVER_HELD_SESSION_MS)
  expect(OFFICE_SESSION_MS).toBe(12 * 60 * 60 * 1000)
  expect(DRIVER_HELD_SESSION_MS).toBe(16 * 60 * 60 * 1000)
})

it('warns the office for the last fifteen minutes and not after the cap', () => {
  const before = new Date(signedIn.getTime() + OFFICE_SESSION_MS - OFFICE_WARNING_LEAD_MS - 1)
  const at = new Date(signedIn.getTime() + OFFICE_SESSION_MS - OFFICE_WARNING_LEAD_MS)
  const end = new Date(signedIn.getTime() + OFFICE_SESSION_MS)
  expect(officeSessionWarning(signedIn, before)).toBe(false)
  expect(officeSessionWarning(signedIn, at)).toBe(true)
  expect(officeSessionWarning(signedIn, new Date(end.getTime() - 1))).toBe(true)
  expect(officeSessionWarning(signedIn, end)).toBe(false)
})

it('shows the driver banners around twelve hours, and the cap banner only while a Ride holds', () => {
  const lead = new Date(signedIn.getTime() + OFFICE_SESSION_MS - DRIVER_WARNING_LEAD_MS)
  const before = new Date(lead.getTime() - 1)
  const twelve = new Date(signedIn.getTime() + OFFICE_SESSION_MS)
  const capLead = new Date(signedIn.getTime() + DRIVER_HELD_SESSION_MS - DRIVER_WARNING_LEAD_MS)
  const sixteen = new Date(signedIn.getTime() + DRIVER_HELD_SESSION_MS)

  expect(driverSessionBanners(signedIn, before, false)).toEqual([])
  expect(driverSessionBanners(signedIn, lead, false)).toEqual(['ending'])
  expect(driverSessionBanners(signedIn, twelve, false)).toEqual([])

  expect(driverSessionBanners(signedIn, before, true)).toEqual([])
  expect(driverSessionBanners(signedIn, lead, true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, twelve, true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, new Date(capLead.getTime() - 1), true)).toEqual(['held'])
  expect(driverSessionBanners(signedIn, capLead, true)).toEqual(['held', 'cap'])
  expect(driverSessionBanners(signedIn, new Date(sixteen.getTime() - 1), true)).toEqual(['held', 'cap'])
  expect(driverSessionBanners(signedIn, sixteen, true)).toEqual([])
  expect(driverSessionBanners(signedIn, capLead, false)).toEqual([])
})

it('holds a driver session only for today\'s in-progress Ride', () => {
  const now = instantFromWallClock('2026-10-25T12:00', 'Europe/Zagreb')
  const held = {
    state: 'accepted' as const,
    mustAccept: true,
    driverId: 'driver-1',
    pickupAt: instantFromWallClock('2026-10-25T09:00', 'Europe/Zagreb'),
    timeZone: 'Europe/Zagreb',
    operationalDayStartHour: 5,
  }
  expect(rideHoldsDriverSession(held, now)).toBe(true)
  expect(rideHoldsDriverSession({
    ...held,
    state: 'assigned',
    mustAccept: false,
  }, now)).toBe(true)
  expect(rideHoldsDriverSession({
    ...held,
    pickupAt: instantFromWallClock('2026-10-24T12:00', 'Europe/Zagreb'),
  }, now)).toBe(false)
  expect(rideHoldsDriverSession({
    ...held,
    pickupAt: instantFromWallClock('2026-10-25T18:00', 'Europe/Zagreb'),
  }, now)).toBe(false)
  expect(rideHoldsDriverSession({
    ...held,
    state: 'assigned',
    mustAccept: true,
  }, now)).toBe(false)
  for (const state of ['done', 'no-show', 'cancelled'] as const)
    expect(rideHoldsDriverSession({ ...held, state }, now)).toBe(false)
  expect(rideHoldsDriverSession({ ...held, driverId: null }, now)).toBe(false)
  expect(rideHoldsDriverSession({ ...held, state: 'handed_off', driverId: null }, now)).toBe(false)
})

it('resets the office idle clock on a visible action, and not on a refresh or a hidden tab', () => {
  const clock = createOfficeIdleClock(0)
  expect(clock.due(OFFICE_IDLE_MS - 1)).toBe(false)
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)

  clock.action(10 * 60 * 1000, false)
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)

  clock.refresh()
  expect(clock.due(OFFICE_IDLE_MS)).toBe(true)

  clock.action(5 * 60 * 1000, true)
  expect(clock.due(5 * 60 * 1000 + OFFICE_IDLE_MS - 1)).toBe(false)
  expect(clock.due(5 * 60 * 1000 + OFFICE_IDLE_MS)).toBe(true)
})
