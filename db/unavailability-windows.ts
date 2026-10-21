import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, pgPolicy, timestamp, uuid } from 'drizzle-orm/pg-core'
import { drivers } from './drivers'
import { partners } from './partners'
import { appRole, tenantTable } from './tenant-table'
import { vehicles } from './vehicles'

/**
 * One unavailability window (Nedostupnost, ADR-0034), owned by capacity:
 * a Driver, a Vehicle, or a Partner is away for `[starts_at, ends_at)`.
 * Exactly one of the three ids is set. Existing rows keep a null Partner.
 * A window has no reason and no kind, so no health data is stored.
 * `removed` is the soft remove: a removed window no longer counts and stays
 * until the retention job deletes it.
 *
 * The composite foreign keys refuse another Tenant's Driver, Vehicle, or
 * Partner. v1 grants no delete on those tables, so they do not cascade.
 *
 * The app role may DELETE for the daily job only: ADR-0034 allows that
 * grant on this table, for windows that ended more than 90 days ago. The
 * restrictive policy holds every delete to that, so no route can delete a
 * window that still counts. FORCE RLS and the grants are in the migration;
 * drizzle-kit cannot emit them.
 */
export const unavailabilityWindows = tenantTable('unavailability_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverId: uuid('driver_id'),
  vehicleId: uuid('vehicle_id'),
  partnerId: uuid('partner_id'),
  startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
  removed: boolean('removed').notNull().default(false),
}, table => [
  index('unavailability_windows_driver_idx').on(table.tenantId, table.driverId, table.startsAt).where(sql`${table.driverId} is not null`),
  index('unavailability_windows_vehicle_idx').on(table.tenantId, table.vehicleId, table.startsAt).where(sql`${table.vehicleId} is not null`),
  index('unavailability_windows_partner_idx').on(table.tenantId, table.partnerId, table.startsAt).where(sql`${table.partnerId} is not null`),
  // The retention job deletes by end, removed or not.
  index('unavailability_windows_ends_at_idx').on(table.tenantId, table.endsAt),
  foreignKey({
    name: 'unavailability_windows_driver_fk',
    columns: [table.tenantId, table.driverId],
    foreignColumns: [drivers.tenantId, drivers.id],
  }),
  foreignKey({
    name: 'unavailability_windows_vehicle_fk',
    columns: [table.tenantId, table.vehicleId],
    foreignColumns: [vehicles.tenantId, vehicles.id],
  }),
  foreignKey({
    name: 'unavailability_windows_partner_fk',
    columns: [table.tenantId, table.partnerId],
    foreignColumns: [partners.tenantId, partners.id],
  }),
  check('unavailability_windows_one_owner', sql`num_nonnulls(${table.driverId}, ${table.vehicleId}, ${table.partnerId}) = 1`),
  check('unavailability_windows_order', sql`${table.startsAt} < ${table.endsAt}`),
  pgPolicy('unavailability_windows_retention_delete', {
    as: 'restrictive',
    for: 'delete',
    to: appRole,
    using: sql`${table.endsAt} < now() - interval '90 days'`,
  }),
], { oneRowPerTenant: false })
