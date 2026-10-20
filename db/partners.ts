import { sql } from 'drizzle-orm'
import { check, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { DRIVER_EMAIL_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH, PARTNER_NAME_MAX_LENGTH, PARTNER_NOTE_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Partner, many per Tenant.
 * `tenant_id` is not the key. The name is not unique: two subcontractors
 * may share one (ADR-0049). The writer trims the name, the phone, the email,
 * and the note; the checks refuse a row that still has surrounding spaces.
 * Phone and email use the same bounds as a Driver. A blank is null, not an
 * empty string. The note is one standing text, up to 2000 characters.
 * `(tenant_id, id)` is unique so a Ride and an unavailability window can
 * reference this Partner with a composite foreign key.
 * `archived_at` hides the Partner from the default list. The row stays, so
 * a Ride already handed to it can still read the name. There is no delete.
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const nameMax = sql.raw(String(PARTNER_NAME_MAX_LENGTH))
const phoneMax = sql.raw(String(DRIVER_PHONE_MAX_LENGTH))
const emailMax = sql.raw(String(DRIVER_EMAIL_MAX_LENGTH))
const noteMax = sql.raw(String(PARTNER_NOTE_MAX_LENGTH))

export const partners = tenantTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  note: text('note'),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, table => [
  check(
    'partners_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'partners_phone',
    sql`${table.phone} is null or (${table.phone} = btrim(${table.phone}) and length(${table.phone}) between 1 and ${phoneMax})`,
  ),
  check(
    'partners_email',
    sql`${table.email} is null or (${table.email} = btrim(${table.email}) and length(${table.email}) between 3 and ${emailMax} and position('@' in ${table.email}) > 1 and position(' ' in ${table.email}) = 0)`,
  ),
  check(
    'partners_note',
    sql`${table.note} is null or (${table.note} = btrim(${table.note}) and length(${table.note}) between 1 and ${noteMax})`,
  ),
  uniqueIndex('partners_tenant_id_id').on(table.tenantId, table.id),
], { oneRowPerTenant: false })
