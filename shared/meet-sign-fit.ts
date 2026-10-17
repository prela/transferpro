/**
 * The meet sign stays at least this large. 28px is still readable when the
 * phone is held up. A tabla that does not fit at 28px stays there and
 * scrolls inside the frame (ADR-0038).
 */
export const MEET_SIGN_MIN_PX = 28

/**
 * Largest whole-pixel size at or under `startPx` for which `fits` is true.
 * `scrolls` means even the minimum does not fit, so the frame must scroll.
 */
export function fittedMeetSign(
  startPx: number,
  fits: (sizePx: number) => boolean,
): { sizePx: number, scrolls: boolean } {
  let size = Math.max(MEET_SIGN_MIN_PX, Math.floor(startPx))
  while (size > MEET_SIGN_MIN_PX && !fits(size))
    size -= 1
  return { sizePx: size, scrolls: !fits(size) }
}
