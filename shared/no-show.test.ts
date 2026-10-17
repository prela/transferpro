import { expect, it } from 'vitest'
import { canMarkNoShow, noShowWaitBounds, noShowWaitElapsed, noShowWindowLabels } from './no-show'

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

it('names a same-day No-show window by the clock, and a window that crosses midnight by the full date', () => {
  // 08:00Z is 10:00 in Europe/Zagreb (CEST). Twenty-five minutes stays on that day.
  const sameDay = noShowWindowLabels(
    new Date('2026-10-13T08:00:00.000Z'),
    new Date('2026-10-13T08:25:00.000Z'),
    'Europe/Zagreb',
    'hr',
  )
  expect(sameDay).toEqual({ from: '10:00', until: '10:25' })

  const sameDayEnglish = noShowWindowLabels(
    new Date('2026-10-13T08:00:00.000Z'),
    new Date('2026-10-13T08:25:00.000Z'),
    'Europe/Zagreb',
    'en',
  )
  expect(sameDayEnglish).toEqual({ from: '10:00', until: '10:25' })

  // 21:50Z is 23:50, and 22:15Z is 00:15 the next calendar day.
  const nextDay = noShowWindowLabels(
    new Date('2026-10-13T21:50:00.000Z'),
    new Date('2026-10-13T22:15:00.000Z'),
    'Europe/Zagreb',
    'hr',
  )
  expect(nextDay).toEqual({ from: '13. 10. 2026. 23:50', until: '14. 10. 2026. 00:15' })

  const nextDayEnglish = noShowWindowLabels(
    new Date('2026-10-13T21:50:00.000Z'),
    new Date('2026-10-13T22:15:00.000Z'),
    'Europe/Zagreb',
    'en',
  )
  expect(nextDayEnglish).toEqual({ from: '13/10/2026, 23:50', until: '14/10/2026, 00:15' })
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
