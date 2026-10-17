/**
 * Below this the sign is no longer a sign. The rest scrolls inside the frame
 * instead of being clipped (ADR-0038).
 */
export const MEET_SIGN_MIN_PX = 8

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
