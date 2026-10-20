import type { Page } from '@playwright/test'
import { addCalendarDays, instantFromWallClock, operationalDateInTimeZone } from '../../shared/date'

const zone = 'Europe/Zagreb'

const pinned = new WeakMap<Page, Date>()

/**
 * Fix the browser clock before the first navigation.
 * A spec that records a Ride on the operational day the board opens on
 * reads this same instant. A wall clock of 04:55, 05:00, or 05:05 cannot
 * then move the board onto the next day while the seed stays behind.
 *
 * The default instant is the real clock. A Pozornost row passes
 * {@link previousOperationalNoon}: noon on the operational day that
 * contains 05:00 is still ahead, so it is not a past pickup.
 */
export async function pinOperationalClock(page: Page, time = new Date()): Promise<void> {
  await page.clock.install({ time })
  pinned.set(page, time)
}

/** The instant {@link pinOperationalClock} installed for this page. */
export function operationalNow(page: Page): Date {
  const time = pinned.get(page)
  if (time === undefined)
    throw new Error('Pin the operational clock before reading it.')
  return time
}

/** Operational day of the pinned instant. The board opens on this date. */
export function operationalDay(page: Page): string {
  return operationalDateInTimeZone(zone, operationalNow(page))
}

/**
 * Noon on the operational day before the one that contains `now`.
 * That noon is already past at 04:55, 05:00, and 05:05, and it sits
 * inside the day rather than on the 05:00 line. 20 October 2026 is
 * still summer time, so the three noons are the literals in
 * `shared/date.test.ts`.
 */
export function previousOperationalNoon(now = new Date()): Date {
  const day = addCalendarDays(operationalDateInTimeZone(zone, now), -1)
  return instantFromWallClock(`${day}T12:00`, zone)
}
