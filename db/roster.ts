import { date, foreignKey, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { drivers } from './drivers'
import { tenantTable } from './tenant-table'
import { vehicles } from './vehicles'

/**
 * One Driver's Vehicle for one calendar date, many per Tenant.
 * `roster_date` is a `date`: the day the office picked, with no time and no zone.
 * "Today" is that calendar date in the Tenant time zone; it is not stored here.
 * A Driver has at most one row per day, and a Vehicle is on at most one row per day.
 * Clearing deletes the row. There is no archive column: an archived Vehicle
 * stays on a row already written until the office clears or replaces it.
 * The composite foreign keys are the database backstop: a row can name only
 * a Driver and a Vehicle of this Tenant. The roster module still checks the
 * ids under the tenant session before it writes. v1 grants no delete on
 * Drivers or Vehicles, so these keys do not follow a delete.
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
  foreignKey({
    name: 'roster_driver_fk',
    columns: [table.tenantId, table.driverId],
    foreignColumns: [drivers.tenantId, drivers.id],
  }),
  foreignKey({
    name: 'roster_vehicle_fk',
    columns: [table.tenantId, table.vehicleId],
    foreignColumns: [vehicles.tenantId, vehicles.id],
  }),
], { oneRowPerTenant: false })
