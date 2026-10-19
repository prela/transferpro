/**
 * Sixty minutes, in milliseconds. The unclosed mark includes this instant.
 * It starts at the scheduled pickup, including an earlier day. A recorded
 * landing does not move it. It is not the no-show wait and it sends
 * nothing (ADR-0027). Every unclosed mark reads this value; do not define
 * a second copy.
 */
export const UNCLOSED_MARK_MS = 60 * 60 * 1000
