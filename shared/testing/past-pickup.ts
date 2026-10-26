import { instantFromWallClock, operationalDateInTimeZone } from '../date'

/** One minute. Just after 05:00 this falls on the previous operational day. */
const PAST_PICKUP_OFFSET_MS = 60_000

const ZONE = 'Europe/Zagreb'
const DAY_START_HOUR = 5

/**
 * A pickup already past, on the operational day that contains `now`.
 * Test-only. The app does not import this file.
 * One offset for the session RLS test and the session e2e. Just after 05:00
 * the offset is the previous day, so the pickup is the start of this day.
 */
export function pastPickupOnThisOperationalDay(now: Date = new Date()): Date {
  const day = operationalDateInTimeZone(ZONE, now, DAY_START_HOUR)
  const start = instantFromWallClock(`${day}T05:00`, ZONE).getTime()
  const nowMs = now.getTime()
  const preferred = nowMs - PAST_PICKUP_OFFSET_MS
  if (preferred > start)
    return new Date(preferred)
  // The offset is before this operational day. The day start is already past
  // whenever now is after it, and it is still on this day.
  if (nowMs > start)
    return new Date(start)
  return new Date(nowMs - 1)
}
