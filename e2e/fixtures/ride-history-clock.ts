import { addCalendarDays, operationalDateInTimeZone } from '../../shared/date'

const zone = 'Europe/Zagreb'

/**
 * Pickup walls for the Ride-history specs. A create refuses a pickup more
 * than 30×24 hours before now, so a fixed October date goes stale. Newest
 * is yesterday at 12:00 in Europe/Zagreb. The older rows step back from
 * that day and stay inside the window. `index` minutes before noon stay
 * on the newest day, so those Rides sort just behind the newest.
 */
export function rideHistoryClock(now: Date = new Date()) {
  const newestDay = addCalendarDays(operationalDateInTimeZone(zone, now, 5), -1)
  return {
    newestWall: `${newestDay}T12:00`,
    doneWall: `${addCalendarDays(newestDay, -2)}T12:00`,
    noShowWall: `${addCalendarDays(newestDay, -3)}T12:00`,
    oldestWall: `${addCalendarDays(newestDay, -10)}T09:00`,
    englishWall: `${newestDay}T15:30`,
    wallBefore(index: number): string {
      const total = 12 * 60 - index
      const hour = String(Math.floor(total / 60)).padStart(2, '0')
      const minute = String(total % 60).padStart(2, '0')
      return `${newestDay}T${hour}:${minute}`
    },
  }
}
