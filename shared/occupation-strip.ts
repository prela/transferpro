import type { ScheduleRide } from './ride-schedule'
import type { RideState } from './transfer'
import { isCalendarDate, localDayBounds, wallClockInTimeZone } from './date'
import { judgeSchedule, occupiedEnd } from './ride-schedule'
import { OPERATIONAL_DAY_START_MAX, OPERATIONAL_DAY_START_MIN, WAIT_MINUTES_MAX, WAIT_MINUTES_MIN } from './tenant-settings'

/**
 * Desktop occupation strip (ADR-0038). A block is the ADR-0029 window:
 * it opens at the pickup and ends at the landing plus the transfer
 * duration, or at the pickup plus that duration when no landing is stored.
 * The relocation gap is a warning, not part of the block.
 */

const COLLAPSED = 'collapsed'

export type OccupationWarning = 'overlap' | 'tight'

/** One Ride the day list already holds. Finished and unassigned rides are ignored. */
export interface OccupationStripRide {
  readonly rideId: string
  readonly state: RideState
  readonly pickupAt: string
  readonly landingAt: string | null
  readonly driverId: string | null
  readonly vehicleId: string | null
}

export interface OccupationStripBlock {
  readonly rideId: string
  /** Unclipped occupation window. A landing moves the end, not the start. */
  readonly start: string
  readonly end: string
  /** Fraction of the operational day, clipped to that day. */
  readonly left: number
  readonly width: number
  readonly warning: OccupationWarning | null
}

export interface OccupationStripRow {
  readonly vehicleId: string
  readonly rosterDriverIds: readonly string[]
  readonly blocks: readonly OccupationStripBlock[]
}

export interface OccupationStripTick {
  readonly left: number
  readonly hour: number
}

export interface OccupationStrip {
  readonly startMs: number
  readonly endMs: number
  /** Null when now is outside the half-open operational day. */
  readonly now: number | null
  readonly ticks: readonly OccupationStripTick[]
  readonly rows: readonly OccupationStripRow[]
}

export function placeOccupationStrip(input: {
  readonly day: string
  readonly timeZone: string
  readonly startHour: number
  readonly durationMinutes: number
  readonly gapMinutes: number
  readonly now: Date
  readonly rides: readonly OccupationStripRide[]
  readonly roster: readonly { readonly driverId: string, readonly vehicleId: string }[]
}): OccupationStrip {
  if (!isCalendarDate(input.day))
    throw new RangeError('Day is not a calendar date.')
  if (!Number.isInteger(input.startHour) || input.startHour < OPERATIONAL_DAY_START_MIN || input.startHour > OPERATIONAL_DAY_START_MAX)
    throw new RangeError('Operational-day start is not a whole hour from 0 through 8.')
  assertMinutes(input.durationMinutes)
  assertMinutes(input.gapMinutes)
  if (Number.isNaN(input.now.getTime()))
    throw new RangeError('Now is not a valid time.')

  const bounds = localDayBounds(input.day, input.timeZone, input.startHour)
  const axisStart = bounds.start.getTime()
  const axisEnd = bounds.end.getTime()
  const span = axisEnd - axisStart
  const occupying = input.rides.flatMap(ride => occupy(ride, input.durationMinutes))
  const rows = vehicleIds(input.roster, occupying).map(vehicleId => ({
    vehicleId,
    rosterDriverIds: rosterDrivers(input.roster, vehicleId),
    blocks: occupying
      .filter(ride => ride.vehicleId === vehicleId)
      .flatMap(ride => blockFor(ride, occupying, input.durationMinutes, input.gapMinutes, axisStart, axisEnd, span))
      .sort((left, right) => left.start.localeCompare(right.start) || left.rideId.localeCompare(right.rideId)),
  }))

  return {
    startMs: axisStart,
    endMs: axisEnd,
    now: nowFraction(input.now.getTime(), axisStart, axisEnd, span),
    ticks: hourTicks(bounds.start, bounds.end, input.timeZone, axisStart, span),
    rows,
  }
}

/** Absent, or any value other than collapsed, leaves the strip open. */
export function readOccupationStripCollapsed(
  storage: { getItem: (key: string) => string | null },
  key: string,
): boolean {
  return storage.getItem(key) === COLLAPSED
}

export function writeOccupationStripCollapsed(
  storage: { setItem: (key: string, value: string) => void },
  key: string,
  collapsed: boolean,
): void {
  storage.setItem(key, collapsed ? COLLAPSED : 'open')
}

export function occupationStripStorageKey(tenantId: string, userId: string): string {
  return `transferpro-occupation-strip:${tenantId}:${userId}`
}

function assertMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < WAIT_MINUTES_MIN || minutes > WAIT_MINUTES_MAX)
    throw new RangeError('Minutes are not a whole number from 1 through 1440.')
}

function occupy(ride: OccupationStripRide, durationMinutes: number): ScheduleRide[] {
  if (ride.state !== 'assigned' && ride.state !== 'accepted')
    return []
  if (ride.driverId === null || ride.vehicleId === null)
    return []
  const pickupAt = new Date(ride.pickupAt)
  const landingAt = ride.landingAt === null ? null : new Date(ride.landingAt)
  if (Number.isNaN(pickupAt.getTime()) || (landingAt !== null && Number.isNaN(landingAt.getTime())))
    throw new RangeError('Ride time is not a valid instant.')
  // A landing that finishes the duration before the pickup occupies nothing.
  if (occupiedEnd(pickupAt, landingAt, durationMinutes).getTime() <= pickupAt.getTime())
    return []
  return [{
    rideId: ride.rideId,
    pickupAt,
    landingAt,
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
  }]
}

function vehicleIds(
  roster: readonly { readonly vehicleId: string }[],
  occupying: readonly ScheduleRide[],
): string[] {
  const ids = new Set<string>()
  for (const row of roster)
    ids.add(row.vehicleId)
  for (const ride of occupying)
    ids.add(ride.vehicleId)
  return [...ids].sort()
}

function rosterDrivers(
  roster: readonly { readonly driverId: string, readonly vehicleId: string }[],
  vehicleId: string,
): string[] {
  const ids: string[] = []
  for (const row of roster) {
    if (row.vehicleId === vehicleId && !ids.includes(row.driverId))
      ids.push(row.driverId)
  }
  return ids.sort()
}

function blockFor(
  ride: ScheduleRide,
  occupying: readonly ScheduleRide[],
  durationMinutes: number,
  gapMinutes: number,
  axisStart: number,
  axisEnd: number,
  span: number,
): OccupationStripBlock[] {
  const startMs = ride.pickupAt.getTime()
  const endMs = occupiedEnd(ride.pickupAt, ride.landingAt, durationMinutes).getTime()
  if (endMs <= axisStart || startMs >= axisEnd)
    return []
  const visibleStart = Math.max(startMs, axisStart)
  const visibleEnd = Math.min(endMs, axisEnd)
  return [{
    rideId: ride.rideId,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    left: (visibleStart - axisStart) / span,
    width: (visibleEnd - visibleStart) / span,
    warning: warningOf(ride, occupying, durationMinutes, gapMinutes),
  }]
}

function warningOf(
  ride: ScheduleRide,
  occupying: readonly ScheduleRide[],
  durationMinutes: number,
  gapMinutes: number,
): OccupationWarning | null {
  const verdict = judgeSchedule(ride, occupying, durationMinutes, gapMinutes)
  if (verdict.overlaps.length > 0)
    return 'overlap'
  if (verdict.tightGaps.length > 0)
    return 'tight'
  return null
}

function nowFraction(nowMs: number, axisStart: number, axisEnd: number, span: number): number | null {
  if (nowMs < axisStart || nowMs >= axisEnd)
    return null
  return (nowMs - axisStart) / span
}

function hourTicks(start: Date, end: Date, timeZone: string, axisStart: number, span: number): OccupationStripTick[] {
  const ticks: OccupationStripTick[] = []
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += 60 * 60 * 1000) {
    const wall = wallClockInTimeZone(timeZone, new Date(cursor))
    ticks.push({
      left: (cursor - axisStart) / span,
      hour: Number(wall.slice(11, 13)),
    })
  }
  return ticks
}
