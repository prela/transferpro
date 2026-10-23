/**
 * Sixty minutes, in milliseconds. The unclosed mark includes this instant.
 * It is not the no-show wait and it sends nothing. Every unclosed mark
 * reads this value; do not define a second copy.
 * Temporarily the mark is this long after the scheduled pickup, including
 * an earlier day. ADR-0055's occupied end comes in #476.
 */
export const UNCLOSED_MARK_MS = 60 * 60 * 1000

/**
 * What the office home read and the day read pass. The landing and the
 * transfer duration are part of the question. Temporarily they do not
 * change the answer: the mark is pickup plus 60 minutes. ADR-0055's
 * occupied end comes in #476.
 */
export interface UnclosedMarkInput {
  readonly pickupAt: string
  readonly landingAt: string | null
  readonly nowMs: number
  readonly transferDurationMinutes: number
}

/**
 * Whether the unclosed mark is on for a Ride that already qualifies:
 * in progress, or handed off. Temporarily the instant is the scheduled
 * pickup plus 60 minutes, and that instant is included. ADR-0055's
 * occupied end comes in #476.
 */
export function unclosedMarkOn(input: UnclosedMarkInput): boolean {
  const pickup = new Date(input.pickupAt).getTime()
  if (Number.isNaN(pickup))
    throw new RangeError('Pickup is not a valid time.')
  return input.nowMs - pickup >= UNCLOSED_MARK_MS
}
