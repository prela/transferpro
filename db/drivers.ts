import { sql } from 'drizzle-orm'
import { boolean, check, date, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { DRIVER_EMAIL_MAX_LENGTH, DRIVER_KINDS, DRIVER_MEMBER_ID_MAX_LENGTH, DRIVER_NAME_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Driver, many per Tenant.
 * `tenant_id` is not the key. The name and the phone are trimmed by the
 * writer; the checks refuse a row that still has surrounding spaces.
 * Kind is a check, not a Postgres enum, so a later kind is a constraint change.
 * The licence columns are `date`: a calendar day, with no time and no zone.
 * `member_user_id` is optional. The partial unique index is one Driver per
 * member in the Tenant; several Drivers may have no account.
 * `email` is one address. It is required when a member is linked, because
 * that address is the sign-in email. It may be null when there is no account.
 * Two Drivers may share an address. The writer trims it; a blank is null.
 * A trigger in the migration refuses a member who is not a driver of this
 * Tenant. The view `app.tenant_member` only returns the session's Tenant,
 * so a member of another Tenant fails that check.
 * `(tenant_id, id)` is unique so a Ride and a roster row can reference this
 * Driver and another Tenant's id in the same breath (migration 0019).
 * There is no archived or inactive column. There is no delete in this ticket.
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const kinds = sql.raw(DRIVER_KINDS.map(kind => `'${kind}'`).join(', '))
const nameMax = sql.raw(String(DRIVER_NAME_MAX_LENGTH))
const phoneMax = sql.raw(String(DRIVER_PHONE_MAX_LENGTH))
const memberMax = sql.raw(String(DRIVER_MEMBER_ID_MAX_LENGTH))
const emailMax = sql.raw(String(DRIVER_EMAIL_MAX_LENGTH))

export const drivers = tenantTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  drivingLicenceExpiresOn: date('driving_licence_expires_on', { mode: 'string' }).notNull(),
  transportLicenceExpiresOn: date('transport_licence_expires_on', { mode: 'string' }).notNull(),
  memberUserId: text('member_user_id'),
  mustAccept: boolean('must_accept').notNull().default(false),
}, table => [
  check(
    'drivers_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'drivers_kind',
    sql`${table.kind} in (${kinds})`,
  ),
  check(
    'drivers_phone',
    sql`${table.phone} = btrim(${table.phone}) and length(${table.phone}) between 1 and ${phoneMax}`,
  ),
  check(
    'drivers_email',
    sql`${table.email} is null or (${table.email} = btrim(${table.email}) and length(${table.email}) between 3 and ${emailMax} and position('@' in ${table.email}) > 1 and position(' ' in ${table.email}) = 0)`,
  ),
  check(
    'drivers_email_when_linked',
    sql`${table.memberUserId} is null or ${table.email} is not null`,
  ),
  check(
    'drivers_member_user_id',
    sql`${table.memberUserId} is null or (${table.memberUserId} = btrim(${table.memberUserId}) and length(${table.memberUserId}) between 1 and ${memberMax})`,
  ),
  // Null member ids are outside the index, so more than one unlinked Driver is allowed.
  uniqueIndex('drivers_one_member').on(table.tenantId, table.memberUserId).where(sql`${table.memberUserId} is not null`),
  uniqueIndex('drivers_tenant_id_id').on(table.tenantId, table.id),
], { oneRowPerTenant: false })
