/**
 * Wait after a failed attempt, in order: 1 minute, 5 minutes, 30 minutes.
 * The fourth failure has no next wait. The entry is then failed.
 * Four sends in all, about 36 minutes after an immediate first attempt.
 */
export const MAIL_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const

/**
 * Delay before the next send after `failedAttempts` failures.
 * Null when there is no further send. Zero failures is not a schedule:
 * the row's first job is the one-minute wait from the write.
 */
export function retryDelayMs(failedAttempts: number): number | null {
  return MAIL_RETRY_DELAYS_MS[failedAttempts - 1] ?? null
}
