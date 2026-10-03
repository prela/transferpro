import { sql } from 'drizzle-orm'
import { check, text } from 'drizzle-orm/pg-core'
import { tenantTable } from './tenant-table'

export { account, invitation, member, organization, session, user, verification } from './auth-schema'
export { tenantInvitation } from './tenant-invitation'
export { tenantMember } from './tenant-member'

/**
 * One row per Tenant. No settings HTTP route in this package.
 * `default_locale` is the Tenant default; a user's own locale lives on the auth user.
 */

export const tenantSettings = tenantTable('tenant_settings', {
  defaultLocale: text('default_locale').notNull(),
  timeZone: text('time_zone').notNull(),
}, table => [
  check(
    'tenant_settings_default_locale',
    sql`${table.defaultLocale} in ('hr', 'en')`,
  ),
])
