import { sql } from 'drizzle-orm'
import { check, foreignKey, index, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { drivers } from './drivers'
import { tenantTable } from './tenant-table'
import { rides } from './transfers'

/**
 * One stored alert for a Ride. v1 records a decline: the Driver who declined,
 * and nothing else. The name is joined when the board reads the row.
 * The row is never updated or deleted. A later assignment does not erase it.
 * Kind is a check, not an enum, so a later alert is a constraint change.
 * The composite foreign keys refuse another Tenant's Ride or Driver.
 * FORCE RLS and the grants are in the migration. There is no DELETE grant.
 */
export const rideAlerts = tenantTable('ride_alert', {
  id: uuid('id').primaryKey().defaultRandom(),
  rideId: uuid('ride_id').notNull(),
  driverId: uuid('driver_id').notNull(),
  kind: text('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => [
  index('ride_alert_ride').on(table.tenantId, table.rideId),
  foreignKey({
    name: 'ride_alert_ride_fk',
    columns: [table.tenantId, table.rideId],
    foreignColumns: [rides.tenantId, rides.id],
  }),
  foreignKey({
    name: 'ride_alert_driver_fk',
    columns: [table.tenantId, table.driverId],
    foreignColumns: [drivers.tenantId, drivers.id],
  }),
  check('ride_alert_kind', sql`${table.kind} = 'declined'`),
], { oneRowPerTenant: false })
