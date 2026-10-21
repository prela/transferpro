import type { ScheduleResource, UnavailableResource } from '../../../../shared'
import type { OccupyingRide } from './occupation'
import { occupiedEnd } from '../../../../shared'

/**
 * One unavailability window (Nedostupnost, ADR-0034): a Driver, a Vehicle,
 * or a Partner is away for `[startsAt, endsAt)`. Exactly one of the three
 * ids is set. A window carries no reason and no kind. A removed window is
 * never handed to the domain: it no longer counts.
 */
export interface UnavailabilityWindow {
  readonly id: string
  readonly driverId: string | null
  readonly vehicleId: string | null
  readonly partnerId: string | null
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
  if (covering.some(window => window.driverId !== null && window.driverId === subject.driverId))
    resources.push('driver')
  if (covering.some(window => window.vehicleId !== null && window.vehicleId === subject.vehicleId))
    resources.push('vehicle')
  return resources
}

/** The Partner and the instants of a Ride handed to them. */
export interface PartnerSpan {
  readonly partnerId: string
  readonly pickupAt: Date
  readonly landingAt: Date | null
}

/**
 * `partner` when a window covers this Partner during the occupied window.
 * A Ride handed to a Partner does not occupy them; only the window does.
 */
export function partnerUnavailable(
  subject: PartnerSpan,
  windows: readonly UnavailabilityWindow[],
  durationMinutes: number,
): UnavailableResource[] {
  const end = occupiedEnd(subject.pickupAt, subject.landingAt, durationMinutes)
  const covered = windows.some(window =>
    window.partnerId === subject.partnerId && coversSpan(window, subject.pickupAt, end),
  )
  return covered ? ['partner'] : []
}

/**
 * Active Partners that no window covers during the half-open span. An id
 * that is not in `activePartnerIds` is archived or missing, so it is not
 * free. A handed-off Ride is not an argument: it does not take the Partner
 * (ADR-0034). The order is the order of `activePartnerIds`.
 */
export function freePartnerIds(
  activePartnerIds: readonly string[],
  windows: readonly UnavailabilityWindow[],
  from: Date,
  to: Date,
): string[] {
  return activePartnerIds.filter(partnerId =>
    !windows.some(window => window.partnerId === partnerId && coversSpan(window, from, to)),
  )
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
  const partnerId = window.partnerId
  if (partnerId !== null) {
    return rides.filter(ride =>
      ride.partnerId === partnerId
      && partnerUnavailable(
        { partnerId, pickupAt: ride.pickupAt, landingAt: ride.landingAt },
        [window],
        durationMinutes,
      ).length > 0,
    )
  }
  return rides.filter(ride =>
    ride.driverId !== null
    && ride.vehicleId !== null
    && unavailableResources(
      { driverId: ride.driverId, vehicleId: ride.vehicleId, pickupAt: ride.pickupAt, landingAt: ride.landingAt },
      [window],
      durationMinutes,
    ).length > 0,
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
