import { sql } from 'drizzle-orm'
import { check, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { LOCATION_ADDRESS_MAX_LENGTH, LOCATION_KINDS, LOCATION_NAME_MAX_LENGTH, PLACE_PROVIDERS, PLACE_REF_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Location, many per Tenant.
 * `tenant_id` is not the key. The name and the address are trimmed by the
 * writer; the checks refuse a row that still has surrounding spaces.
 * Kind is a check, not a Postgres enum, so a later kind is a constraint change.
 * Archive is `archived_at`: null means on the picker. There is no delete.
 * `(tenant_id, id)` is unique so a Transfer can reference this row and
 * another Tenant's id in the same breath (migration 0017).
 * FORCE RLS is in the migration; drizzle-kit cannot emit it.
 */

const kinds = sql.raw(LOCATION_KINDS.map(kind => `'${kind}'`).join(', '))
const providers = sql.raw(PLACE_PROVIDERS.map(provider => `'${provider}'`).join(', '))
const nameMax = sql.raw(String(LOCATION_NAME_MAX_LENGTH))
const addressMax = sql.raw(String(LOCATION_ADDRESS_MAX_LENGTH))
const placeRefMax = sql.raw(String(PLACE_REF_MAX_LENGTH))

export const locations = tenantTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  address: text('address'),
  /**
   * Optional IATA code. Only kind airport may carry one (ADR-0028).
   * Three ASCII letters, already uppercased by the writer. Null is no code.
   */
  iata: text('iata'),
  /**
   * Optional place from a suggestion. Both columns are set or both are empty.
   * A reference requires an address. The reference is opaque (ADR-0031).
   */
  placeProvider: text('place_provider'),
  placeRef: text('place_ref'),
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
  check(
    'locations_iata',
    sql`${table.iata} is null or ${table.iata} ~ '^[A-Z]{3}$'`,
  ),
  check(
    'locations_iata_airport',
    sql`${table.kind} = 'airport' or ${table.iata} is null`,
  ),
  check(
    'locations_place_pair',
    sql`(${table.placeProvider} is null and ${table.placeRef} is null) or (${table.placeProvider} is not null and ${table.placeRef} is not null)`,
  ),
  check(
    'locations_place_address',
    sql`${table.placeRef} is null or ${table.address} is not null`,
  ),
  check(
    'locations_place_provider',
    sql`${table.placeProvider} is null or ${table.placeProvider} in (${providers})`,
  ),
  check(
    'locations_place_ref',
    sql`${table.placeRef} is null or (${table.placeRef} = btrim(${table.placeRef}) and length(${table.placeRef}) between 1 and ${placeRefMax})`,
  ),
  uniqueIndex('locations_tenant_id_id').on(table.tenantId, table.id),
], { oneRowPerTenant: false })
