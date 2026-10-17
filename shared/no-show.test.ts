import { expect, it } from 'vitest'
import { canMarkNoShow, noShowWaitBounds, noShowWaitElapsed } from './no-show'

const pickup = new Date('2026-10-13T10:00:00.000Z')
const landing = new Date('2026-10-13T12:00:00.000Z')

it('allows a No-show from assigned when the copied flag is off, and only from accepted when it is on', () => {
  expect(canMarkNoShow('assigned', false)).toBe(true)
  expect(canMarkNoShow('accepted', true)).toBe(true)
  expect(canMarkNoShow('assigned', true)).toBe(false)
  expect(canMarkNoShow('accepted', false)).toBe(false)
  expect(canMarkNoShow('unassigned', null)).toBe(false)
  expect(canMarkNoShow('done', false)).toBe(false)
  expect(canMarkNoShow('no-show', true)).toBe(false)
  expect(canMarkNoShow('cancelled', false)).toBe(false)
})

it('names the elsewhere window from the scheduled pickup through the elsewhere wait', () => {
  const bounds = noShowWaitBounds({
    airport: false,
    pickupAt: pickup,
    landingAt: landing,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  })
  expect(bounds.from.toISOString()).toBe('2026-10-13T10:00:00.000Z')
  expect(bounds.until.toISOString()).toBe('2026-10-13T10:25:00.000Z')
})

it('names the airport window from the landing, or from the pickup when the landing is empty', () => {
  const withLanding = noShowWaitBounds({
    airport: true,
    pickupAt: pickup,
    landingAt: landing,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  })
  expect(withLanding.from.toISOString()).toBe('2026-10-13T12:00:00.000Z')
  expect(withLanding.until.toISOString()).toBe('2026-10-13T13:30:00.000Z')

  const withoutLanding = noShowWaitBounds({
    airport: true,
    pickupAt: pickup,
    landingAt: null,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  })
  expect(withoutLanding.from.toISOString()).toBe('2026-10-13T10:00:00.000Z')
  expect(withoutLanding.until.toISOString()).toBe('2026-10-13T11:30:00.000Z')
})

it('counts an elsewhere wait from the scheduled pickup', () => {
  const clock = {
    airport: false,
    pickupAt: pickup,
    landingAt: landing,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  }
  expect(noShowWaitElapsed(clock, new Date('2026-10-13T10:24:59.999Z'))).toBe(false)
  expect(noShowWaitElapsed(clock, new Date('2026-10-13T10:25:00.000Z'))).toBe(true)
})

it('counts an airport wait from the landing, or from the pickup when the landing is empty', () => {
  const withLanding = {
    airport: true,
    pickupAt: pickup,
    landingAt: landing,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  }
  expect(noShowWaitElapsed(withLanding, new Date('2026-10-13T13:29:59.999Z'))).toBe(false)
  expect(noShowWaitElapsed(withLanding, new Date('2026-10-13T13:30:00.000Z'))).toBe(true)

  const withoutLanding = { ...withLanding, landingAt: null }
  // The airport length still applies. Twenty-five minutes is the elsewhere wait.
  expect(noShowWaitElapsed(withoutLanding, new Date('2026-10-13T10:25:00.000Z'))).toBe(false)
  expect(noShowWaitElapsed(withoutLanding, new Date('2026-10-13T11:30:00.000Z'))).toBe(true)
})
