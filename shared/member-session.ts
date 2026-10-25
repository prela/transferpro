import type { TenantRole } from './tenant-role'
import type { RideState } from './transfer'
import { operationalDateInTimeZone } from './date'
import { rideIsInProgress } from './ride-attention'

/**
 * Twelve hours from sign-in (ADR-0057). An Admin or a Dispatcher ends here.
 * A Driver without a holding Ride is refused here too. The database trigger
 * uses `interval '12 hours'`, the same length.
 */
export const OFFICE_SESSION_MS = 12 * 60 * 60 * 1000

/**
 * Sixteen hours from sign-in. A Driver row may live this long so a holding
 * Ride can still be seen after twelve hours. The session is refused at
 * sixteen hours even during that Ride. The database trigger uses
 * `interval '16 hours'`.
 */
export const DRIVER_HELD_SESSION_MS = 16 * 60 * 60 * 1000

/** The open office screen, not the session row. A live refresh does not move it. */
export const OFFICE_IDLE_MS = 30 * 60 * 1000

/** The office warning. It does not sign them out. */
export const OFFICE_WARNING_LEAD_MS = 15 * 60 * 1000

/** The driver banners. Neither blocks the screen. */
export const DRIVER_WARNING_LEAD_MS = 30 * 60 * 1000

/**
 * The cap of the active membership, measured from this sign-in.
 * A holding Ride is the only reason a Driver passes twelve hours.
 */
export function memberSessionCapMs(role: TenantRole, holdingRide: boolean): number {
  if (role === 'driver' && holdingRide)
    return DRIVER_HELD_SESSION_MS
  return OFFICE_SESSION_MS
}

export interface HoldingRideFacts {
  readonly state: RideState
  readonly mustAccept: boolean | null
  readonly driverId: string | null
  readonly pickupAt: Date
  readonly timeZone: string
  readonly operationalDayStartHour: number
}

/**
 * In progress, and the pickup is on the current operational day (ADR-0057).
 * An earlier day's unclosed Ride, a future pickup, and a Ride still waiting
 * on acceptance do not hold the session.
 */
export function rideHoldsDriverSession(ride: HoldingRideFacts, now: Date): boolean {
  if (!rideIsInProgress(ride.state, ride.mustAccept, ride.driverId, ride.pickupAt.getTime(), now.getTime()))
    return false
  const start = ride.operationalDayStartHour
  return operationalDateInTimeZone(ride.timeZone, ride.pickupAt, start)
    === operationalDateInTimeZone(ride.timeZone, now, start)
}

/** Shown before the twelve-hour office end. False once that end has arrived. */
export function officeSessionWarning(signedInAt: Date, now: Date): boolean {
  const end = signedInAt.getTime() + OFFICE_SESSION_MS
  const at = now.getTime()
  return at >= end - OFFICE_WARNING_LEAD_MS && at < end
}

/**
 * `ending` is the plain twelve-hour warning.
 * `held` is that same moment while a Ride is keeping the session open.
 * `cap` is the sixteen-hour warning. It is absent when the Ride has already ended.
 */
export type DriverSessionBanner = 'ending' | 'held' | 'cap'

export function driverSessionBanners(signedInAt: Date, now: Date, holdingRide: boolean): DriverSessionBanner[] {
  const start = signedInAt.getTime()
  const at = now.getTime()
  const twelve = start + OFFICE_SESSION_MS
  const sixteen = start + DRIVER_HELD_SESSION_MS
  if (holdingRide) {
    if (at < twelve - DRIVER_WARNING_LEAD_MS || at >= sixteen)
      return []
    const banners: DriverSessionBanner[] = ['held']
    if (at >= sixteen - DRIVER_WARNING_LEAD_MS)
      banners.push('cap')
    return banners
  }
  if (at >= twelve - DRIVER_WARNING_LEAD_MS && at < twelve)
    return ['ending']
  return []
}

/**
 * The office idle clock. A hidden tab is not a person's action.
 * `refresh` is the live board read: it never moves the clock.
 */
export interface OfficeIdleClock {
  action: (at: number, visible: boolean) => void
  refresh: () => void
  due: (at: number) => boolean
}

export function createOfficeIdleClock(startedAt: number): OfficeIdleClock {
  let lastActionAt = startedAt
  return {
    action(at, visible) {
      if (!visible || at < lastActionAt)
        return
      lastActionAt = at
    },
    refresh() {
      // A board left refreshing still goes idle (ADR-0057).
    },
    due(at) {
      return at - lastActionAt >= OFFICE_IDLE_MS
    },
  }
}
