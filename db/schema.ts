import { sql } from 'drizzle-orm'
import { check, integer, text } from 'drizzle-orm/pg-core'
import { AIRPORT_WAIT_DEFAULT_MINUTES, ELSEWHERE_WAIT_DEFAULT_MINUTES, TIME_ZONE_MAX_LENGTH, WAIT_MINUTES_MAX, WAIT_MINUTES_MIN } from '../shared'
import { tenantTable } from './tenant-table'

export { auditAction, auditEntry } from './audit-entry'
export { account, invitation, member, organization, session, user, verification } from './auth-schema'
export { clients } from './clients'
export { tenantInvitation } from './tenant-invitation'
export { tenantMember } from './tenant-member'

/**
 * One row per Tenant.
 * `default_locale` is the Tenant default; a user's own locale lives on the auth user.
 * The waits are read when a No-show is attempted. They are not copied onto a Ride.
 * `time_zone` is the IANA zone used to display instants.
 * FORCE RLS is already on this table (0000). The policy is the row, so the new columns are covered.
 */

const waitMin = sql.raw(String(WAIT_MINUTES_MIN))
const waitMax = sql.raw(String(WAIT_MINUTES_MAX))
const timeZoneMax = sql.raw(String(TIME_ZONE_MAX_LENGTH))

export const tenantSettings = tenantTable('tenant_settings', {
  defaultLocale: text('default_locale').notNull(),
  timeZone: text('time_zone').notNull(),
  airportWaitMinutes: integer('airport_wait_minutes').notNull().default(AIRPORT_WAIT_DEFAULT_MINUTES),
  elsewhereWaitMinutes: integer('elsewhere_wait_minutes').notNull().default(ELSEWHERE_WAIT_DEFAULT_MINUTES),
}, table => [
  check(
    'tenant_settings_default_locale',
    sql`${table.defaultLocale} in ('hr', 'en')`,
  ),
  check(
    'tenant_settings_airport_wait_minutes',
    sql`${table.airportWaitMinutes} between ${waitMin} and ${waitMax}`,
  ),
  check(
    'tenant_settings_elsewhere_wait_minutes',
    sql`${table.elsewhereWaitMinutes} between ${waitMin} and ${waitMax}`,
  ),
  check(
    'tenant_settings_time_zone',
    sql`length(${table.timeZone}) between 1 and ${timeZoneMax}`,
  ),
])
