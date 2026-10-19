import type { ScheduleResource } from '../../../../shared'
import type { OccupyingRide } from './occupation'
import { occupiedEnd } from '../../../../shared'

/**
 * One unavailability window (Nedostupnost, ADR-0034): a Driver or a Vehicle
 * is away for `[startsAt, endsAt)`. Exactly one of the two ids is set. A
 * window carries no reason and no kind. A removed window is never handed
 * to the domain: it no longer counts.
 */
export interface UnavailabilityWindow {
  readonly id: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly startsAt: Date
  readonly endsAt: Date
}

export interface WindowTimes {
  readonly startsAt: Date
  readonly endsAt: Date
}

/** The Driver, the Vehicle, and the instants of a Ride that occupies them. */
export interface OccupyingSubject {
  readonly driverId: string
  readonly vehicleId: string
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/**
 * Whether the window shares an instant with `[from, to)`. Both are
 * half-open, so a window that ends where the span starts is free, and an
 * empty span occupies nothing.
 */
export function coversSpan(window: WindowTimes, from: Date, to: Date): boolean {
  if (to.getTime() <= from.getTime())
    return false
  return window.startsAt.getTime() < to.getTime() && from.getTime() < window.endsAt.getTime()
}

/**
 * Which of the subject's Driver and Vehicle a window covers during its
 * occupied window (ADR-0029). Each is named once, Driver first. The
 * relocation gap plays no part: a window says who is away, not how far.
 */
export function unavailableResources(
  subject: OccupyingSubject,
  windows: readonly UnavailabilityWindow[],
  durationMinutes: number,
): ScheduleResource[] {
  const end = occupiedEnd(subject.pickupAt, subject.landingAt, durationMinutes)
  const covering = windows.filter(window => coversSpan(window, subject.pickupAt, end))
  const resources: ScheduleResource[] = []
  if (covering.some(window => window.driverId === subject.driverId))
    resources.push('driver')
  if (covering.some(window => window.vehicleId === subject.vehicleId))
    resources.push('vehicle')
  return resources
}

/**
 * The occupying Rides of the window's Driver or Vehicle whose occupied
 * window it covers. Saving the window still succeeds; the office is told
 * which Rides to move.
 */
export function ridesCoveredBy(
  window: UnavailabilityWindow,
  rides: readonly OccupyingRide[],
  durationMinutes: number,
): OccupyingRide[] {
  return rides.filter(ride =>
    unavailableResources(ride, [window], durationMinutes).length > 0,
  )
}

/** The instants a change moved. An unchanged save names none and is audited by nobody. */
export function changedWindowFields(before: WindowTimes, after: WindowTimes): ('startsAt' | 'endsAt')[] {
  const fields: ('startsAt' | 'endsAt')[] = []
  if (before.startsAt.getTime() !== after.startsAt.getTime())
    fields.push('startsAt')
  if (before.endsAt.getTime() !== after.endsAt.getTime())
    fields.push('endsAt')
  return fields
}
