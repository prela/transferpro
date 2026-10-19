/** Windows are kept this long after they end, removed or not (ADR-0034). */
export const UNAVAILABILITY_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Windows that ended strictly before this instant are deleted. A window
 * that ended exactly 90 days ago, or later, stays. Days are whole 24-hour
 * spans in UTC, so the Tenant time zone and a daylight saving change do
 * not move the cutoff.
 */
export function unavailabilityRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - UNAVAILABILITY_RETENTION_DAYS * DAY_MS)
}
