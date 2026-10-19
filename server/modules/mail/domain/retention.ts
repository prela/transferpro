/** Outbox entries are kept this long, whatever their state (ADR-0045). */
export const MAIL_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Entries created strictly before this instant are deleted. An entry exactly
 * 90 days old, or newer, stays. Days are whole 24-hour spans in UTC, so the
 * Tenant time zone and a daylight saving change do not move the cutoff.
 */
export function mailRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - MAIL_RETENTION_DAYS * DAY_MS)
}
