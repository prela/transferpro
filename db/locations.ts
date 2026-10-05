import { sql } from 'drizzle-orm'
import { check, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { LOCATION_ADDRESS_MAX_LENGTH, LOCATION_KINDS, LOCATION_NAME_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Location, many per Tenant.
 * `tenant_id` is not the key. The name and the address are trimmed by the
 * writer; the checks refuse a row that still has surrounding spaces.
 * Kind is a check, not a Postgres enum, so a later kind is a constraint change.
 * Archive is `archived_at`: null means on the picker. There is no delete.
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const kinds = sql.raw(LOCATION_KINDS.map(kind => `'${kind}'`).join(', '))
const nameMax = sql.raw(String(LOCATION_NAME_MAX_LENGTH))
const addressMax = sql.raw(String(LOCATION_ADDRESS_MAX_LENGTH))

export const locations = tenantTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  address: text('address'),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, table => [
  check(
    'locations_name',
    sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${nameMax}`,
  ),
  check(
    'locations_kind',
    sql`${table.kind} in (${kinds})`,
  ),
  check(
    'locations_address',
    sql`${table.address} is null or (${table.address} = btrim(${table.address}) and length(${table.address}) between 1 and ${addressMax})`,
  ),
], { oneRowPerTenant: false })
