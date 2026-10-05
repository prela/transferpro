import { sql } from 'drizzle-orm'
import { check, date, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { VEHICLE_DESCRIPTION_MAX_LENGTH, VEHICLE_KINDS, VEHICLE_PLATE_MAX_LENGTH } from '../shared'
import { tenantTable } from './tenant-table'

/**
 * One Vehicle, many per Tenant.
 * `tenant_id` is not the key. The plate is stored uppercase with no spaces;
 * the check refuses a row that still has surrounding or inner spaces.
 * Kind is a check, not a Postgres enum, so a later kind is a constraint change.
 * The expiry columns are `date`: a calendar day, with no time and no zone.
 * Archive is `archived_at`: null means on the assignment list. There is no
 * delete. FORCE RLS is in the migration; drizzle-kit cannot emit it.
 * The partial unique index is one live plate per Tenant; an archived plate
 * may be reused.
 */

const kinds = sql.raw(VEHICLE_KINDS.map(kind => `'${kind}'`).join(', '))
const plateMax = sql.raw(String(VEHICLE_PLATE_MAX_LENGTH))
const descriptionMax = sql.raw(String(VEHICLE_DESCRIPTION_MAX_LENGTH))

export const vehicles = tenantTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationPlate: text('registration_plate').notNull(),
  kind: text('kind').notNull(),
  registrationExpiresOn: date('registration_expires_on', { mode: 'string' }).notNull(),
  technicalInspectionExpiresOn: date('technical_inspection_expires_on', { mode: 'string' }).notNull(),
  insuranceExpiresOn: date('insurance_expires_on', { mode: 'string' }).notNull(),
  description: text('description'),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, table => [
  check(
    'vehicles_registration_plate',
    sql`${table.registrationPlate} = upper(regexp_replace(btrim(${table.registrationPlate}), '\\s+', '', 'g')) and length(${table.registrationPlate}) between 1 and ${plateMax}`,
  ),
  check(
    'vehicles_kind',
    sql`${table.kind} in (${kinds})`,
  ),
  check(
    'vehicles_description',
    sql`${table.description} is null or (${table.description} = btrim(${table.description}) and length(${table.description}) between 1 and ${descriptionMax})`,
  ),
  uniqueIndex('vehicles_plate_active').on(table.tenantId, table.registrationPlate).where(sql`${table.archivedAt} is null`),
], { oneRowPerTenant: false })
