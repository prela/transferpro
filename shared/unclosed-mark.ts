/**
 * Sixty minutes, in milliseconds. The unclosed mark includes this instant.
 * It starts at the scheduled pickup, including an earlier day. A recorded
 * landing does not move it. It is not the no-show wait and it sends
 * nothing (ADR-0027). Every unclosed mark reads this value; do not define
 * a second copy.
 */
export const UNCLOSED_MARK_MS = 60 * 60 * 1000

/**
 * What the office home read and the day read pass. The landing and the
 * transfer duration are part of the question. They do not change the
 * answer: the mark stays at the scheduled pickup (ADR-0027).
 */
export interface UnclosedMarkInput {
  readonly pickupAt: string
  readonly landingAt: string | null
  readonly nowMs: number
  readonly transferDurationMinutes: number
}

/**
 * Whether the unclosed mark is on for a Ride that already qualifies:
 * in progress, or handed off. The instant is the scheduled pickup plus
 * 60 minutes, and that instant is included. A stored landing does not
 * move it, and neither does the transfer duration.
 */
export function unclosedMarkOn(input: UnclosedMarkInput): boolean {
  const pickup = new Date(input.pickupAt).getTime()
  if (Number.isNaN(pickup))
    throw new RangeError('Pickup is not a valid time.')
  return input.nowMs - pickup >= UNCLOSED_MARK_MS
}
