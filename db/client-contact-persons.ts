import { sql } from 'drizzle-orm'
import { check, foreignKey, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { CLIENT_NAME_MAX_LENGTH, CONTACT_PERSON_ROLE_MAX_LENGTH, DRIVER_EMAIL_MAX_LENGTH, DRIVER_PHONE_MAX_LENGTH } from '../shared'
import { clients } from './clients'
import { tenantTable } from './tenant-table'

/**
 * Contact persons of one Client (ADR-0049). A child of `app.clients`:
 * the Client table itself does not change (ADR-0018). The composite foreign
 * key refuses another Tenant's Client. None of these rows is the main contact.
 *
 * `removed_at` is the soft remove. A removed person no longer shows and stays
 * until the retention ticket deletes it. This ticket grants no DELETE.
 *
 * Phone and email use the Driver checks. At least one of them is set.
 * The version columns are the Client's (ADR-0046): version 0 has no author,
 * and a later office save records when and who. FORCE RLS and the grants
 * are in the migration; drizzle-kit cannot emit them.
 */

const nameMax = sql.raw(String(CLIENT_NAME_MAX_LENGTH))
const roleMax = sql.raw(String(CONTACT_PERSON_ROLE_MAX_LENGTH))
const phoneMax = sql.raw(String(DRIVER_PHONE_MAX_LENGTH))
const emailMax = sql.raw(String(DRIVER_EMAIL_MAX_LENGTH))

export const clientContactPersons = tenantTable('client_contact_persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  name: text('name').notNull(),
  role: text('role'),
  phone: text('phone'),
  email: text('email'),
  removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
  // A constant default leaves a new row at 0. Adding does not record an author.
  version: integer('version').notNull().default(0),
  dataChangedAt: timestamp('data_changed_at', { withTimezone: true, mode: 'date' }),
  // The member user id. Text, like audit actor ids. No foreign key.
  dataChangedBy: text('data_changed_by'),
}, table => [
  foreignKey({
    name: 'client_contact_persons_client_fk',
    columns: [table.tenantId, table.clientId],
    foreignColumns: [clients.tenantId, clients.id],
  }),
  check(
    'client_contact_persons_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'client_contact_persons_role',
    sql`${table.role} is null or (${table.role} = btrim(${table.role}) and length(${table.role}) between 1 and ${roleMax})`,
  ),
  check(
    'client_contact_persons_phone',
    sql`${table.phone} is null or (${table.phone} = btrim(${table.phone}) and length(${table.phone}) between 1 and ${phoneMax})`,
  ),
  check(
    'client_contact_persons_email',
    sql`${table.email} is null or (${table.email} = btrim(${table.email}) and length(${table.email}) between 3 and ${emailMax} and position('@' in ${table.email}) > 1 and position(' ' in ${table.email}) = 0)`,
  ),
  // A person the office cannot reach is not a contact person.
  check(
    'client_contact_persons_reachable',
    sql`${table.phone} is not null or ${table.email} is not null`,
  ),
  check('client_contact_persons_version', sql`${table.version} >= 0`),
  check('client_contact_persons_data_change', sql`(${table.version} = 0 and ${table.dataChangedAt} is null and ${table.dataChangedBy} is null) or (${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} <> '')`),
], { oneRowPerTenant: false })
