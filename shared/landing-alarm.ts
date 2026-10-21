import type { RideState } from './transfer'

/**
 * Sixty minutes after the expected end. The length is fixed for every
 * Tenant. It is not the transfer duration and it is not the unclosed mark
 * (ADR-0027, ADR-0030).
 */
const LANDING_ALARM_AFTER_END_MS = 60 * 60 * 1000

/**
 * In progress, the same way the office-home list decides it (ADR-0022).
 * Unassigned, handed off, and waiting on acceptance are not in progress.
 * A handed-off Ride has no Driver (ADR-0048). A finished Ride is not.
 * The pickup instant is excluded: the Ride becomes in progress once that
 * instant is past.
 */
export function rideIsInProgress(
  state: RideState,
  mustAccept: boolean | null,
  driverId: string | null,
  pickupMs: number,
  nowMs: number,
): boolean {
  if (state === 'unassigned' || state === 'handed_off')
    return false
  if (state === 'assigned' && mustAccept === true)
    return false
  const finished = state === 'done' || state === 'no-show' || state === 'cancelled'
  return !finished && driverId !== null && pickupMs < nowMs
}

/**
 * Silent landing alarm. Expected end is the stored landing plus the Tenant
 * transfer duration. The alarm includes the instant 60 minutes after that
 * end. No stored landing, or a Ride that is not in progress, has no alarm.
 * This does not move the unclosed mark.
 */
export function landingAlarmOn(
  landingAt: string | null,
  nowMs: number,
  transferDurationMinutes: number,
  inProgress: boolean,
): boolean {
  if (!inProgress || landingAt === null)
    return false
  const landing = new Date(landingAt).getTime()
  if (Number.isNaN(landing))
    throw new RangeError('Landing is not a valid time.')
  const expectedEnd = landing + transferDurationMinutes * 60_000
  return nowMs >= expectedEnd + LANDING_ALARM_AFTER_END_MS
}
