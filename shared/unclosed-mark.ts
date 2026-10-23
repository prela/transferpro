import { occupiedEnd } from './capacity'

/**
 * Sixty minutes, in milliseconds. The unclosed mark includes this instant.
 * It is not the no-show wait and it sends nothing. Every unclosed mark
 * reads this value; do not define a second copy.
 */
export const UNCLOSED_MARK_MS = 60 * 60 * 1000

/**
 * What the office home read and the day read pass. The occupied end is
 * the stored landing plus the transfer duration, or the scheduled pickup
 * plus that duration when no landing is stored (ADR-0055). The expected
 * arrival, the airport mark, and the relocation gap are not part of it.
 */
export interface UnclosedMarkInput {
  readonly pickupAt: string
  readonly landingAt: string | null
  readonly nowMs: number
  readonly transferDurationMinutes: number
}

/**
 * Whether the unclosed mark is on for a Ride that already qualifies:
 * in progress, or handed off. The instant is 60 minutes after the
 * occupied end, and that instant is included. It is the same end the
 * capacity judge uses.
 */
export function unclosedMarkOn(input: UnclosedMarkInput): boolean {
  const pickup = new Date(input.pickupAt)
  if (Number.isNaN(pickup.getTime()))
    throw new RangeError('Pickup is not a valid time.')
  const landing = input.landingAt === null ? null : new Date(input.landingAt)
  if (landing !== null && Number.isNaN(landing.getTime()))
    throw new RangeError('Landing is not a valid time.')
  const end = occupiedEnd(pickup, landing, input.transferDurationMinutes)
  return input.nowMs - end.getTime() >= UNCLOSED_MARK_MS
}
