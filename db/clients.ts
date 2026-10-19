import { sql } from 'drizzle-orm'
import { check, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { CLIENT_KINDS, CLIENT_NAME_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Client, many per Tenant (ADR-0017).
 * `tenant_id` is not the key. The name is trimmed by the writer; the check
 * refuses a row that still has surrounding spaces, an empty name, or a name
 * longer than 200 characters. Kind is a check, not a Postgres enum, so a
 * later kind is a constraint change. There is no delete in this ticket.
 * `(tenant_id, id)` is unique so a Transfer can reference this row and
 * another Tenant's id in the same breath (migration 0017).
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const kinds = sql.raw(CLIENT_KINDS.map(kind => `'${kind}'`).join(', '))
const nameMax = sql.raw(String(CLIENT_NAME_MAX_LENGTH))

export const clients = tenantTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  // A Client has its own version, apart from any Transfer's (ADR-0046). A
  // constant default leaves existing rows at 0 without a table rewrite. The
  // time and the member stay null until an office data save.
  version: integer('version').notNull().default(0),
  dataChangedAt: timestamp('data_changed_at', { withTimezone: true, mode: 'date' }),
  // The member user id. Text, like audit actor ids. No foreign key: a member
  // who has left must not block the row, and the name is read from app.tenant_member.
  dataChangedBy: text('data_changed_by'),
}, table => [
  check(
    'clients_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'clients_kind',
    sql`${table.kind} in (${kinds})`,
  ),
  uniqueIndex('clients_tenant_id_id').on(table.tenantId, table.id),
  check('clients_version', sql`${table.version} >= 0`),
  // Version 0 has no recorded change. A later version names when and who.
  check('clients_data_change', sql`(${table.version} = 0 and ${table.dataChangedAt} is null and ${table.dataChangedBy} is null) or (${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} <> '')`),
], { oneRowPerTenant: false })
