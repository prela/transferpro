/** Removed contact persons are kept this long (ADR-0049). */
export const CONTACT_PERSON_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Persons removed strictly before this instant are deleted. A person removed
 * exactly 90 days ago, or later, stays. A live person has no removal instant
 * and stays. Days are whole 24-hour spans in UTC, so the Tenant time zone
 * and a daylight saving change do not move the cutoff.
 */
export function contactPersonRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - CONTACT_PERSON_RETENTION_DAYS * DAY_MS)
}
