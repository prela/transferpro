import { sql } from 'drizzle-orm'
import { check, text, uuid } from 'drizzle-orm/pg-core'
import { CLIENT_KINDS, CLIENT_NAME_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Client, many per Tenant (ADR-0017).
 * `tenant_id` is not the key. The name is trimmed by the writer; the check
 * refuses a row that still has surrounding spaces, an empty name, or a name
 * longer than 200 characters. Kind is a check, not a Postgres enum, so a
 * later kind is a constraint change. There is no delete in this ticket.
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const kinds = sql.raw(CLIENT_KINDS.map(kind => `'${kind}'`).join(', '))
const nameMax = sql.raw(String(CLIENT_NAME_MAX_LENGTH))

export const clients = tenantTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
}, table => [
  check(
    'clients_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'clients_kind',
    sql`${table.kind} in (${kinds})`,
  ),
], { oneRowPerTenant: false })
