import { date, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { tenantTable } from './tenant-table'

/**
 * One Driver's Vehicle for one calendar date, many per Tenant.
 * `roster_date` is a `date`: the day the office picked, with no time and no zone.
 * "Today" is that calendar date in the Tenant time zone; it is not stored here.
 * A Driver has at most one row per day, and a Vehicle is on at most one row per day.
 * Clearing deletes the row. There is no archive column: an archived Vehicle
 * stays on a row already written until the office clears or replaces it.
 * Driver and Vehicle ids are checked by the roster module under the tenant
 * session. There is no foreign key: this table does not follow a delete that
 * v1 does not grant on Drivers or Vehicles.
 * FORCE RLS and the DELETE grant are in the migration; drizzle-kit cannot emit them.
 */
export const roster = tenantTable('roster', {
  id: uuid('id').primaryKey().defaultRandom(),
  rosterDate: date('roster_date', { mode: 'string' }).notNull(),
  driverId: uuid('driver_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
}, table => [
  uniqueIndex('roster_driver_day').on(table.tenantId, table.rosterDate, table.driverId),
  uniqueIndex('roster_vehicle_day').on(table.tenantId, table.rosterDate, table.vehicleId),
], { oneRowPerTenant: false })
