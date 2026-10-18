import { sql } from 'drizzle-orm'
import { check, foreignKey, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { drivers } from './drivers'
import { tenantTable } from './tenant-table'
import { rides } from './transfers'
import { vehicles } from './vehicles'

/**
 * One mail the office asked to send, many per Tenant (ADR-0045).
 * The row holds the kind and the ids. It does not hold an address, a name,
 * a subject, or a body: those are read from the current rows when the mail
 * is sent. `invitation_id` is room for an invitation. This ticket writes
 * only work orders. A work order names the Ride, the Driver, and the status.
 * `vehicle_id` is the Vehicle released by "no longer yours". The shape
 * check refuses it on every other work order, and an invitation may not set it.
 * An invitation will name only the invitation id.
 * States and the attempt columns are all here, so a later ticket adds no
 * column. `pending` is still being tried. `sent` went out. `failed` is
 * after the automatic attempts. `stale` no longer matters.
 * The composite foreign keys refuse another Tenant's Ride, Driver, or Vehicle.
 * There is no DELETE grant. ADR-0045 allows a later retention job to delete
 * rows older than 90 days; that grant is not in this migration.
 * FORCE RLS and the grants are in the migration. drizzle-kit cannot emit them.
 */
export const mailOutbox = tenantTable('mail_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  rideId: uuid('ride_id'),
  driverId: uuid('driver_id'),
  vehicleId: uuid('vehicle_id'),
  workOrderStatus: text('work_order_status'),
  invitationId: uuid('invitation_id'),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => [
  foreignKey({
    name: 'mail_outbox_ride_fk',
    columns: [table.tenantId, table.rideId],
    foreignColumns: [rides.tenantId, rides.id],
  }),
  foreignKey({
    name: 'mail_outbox_driver_fk',
    columns: [table.tenantId, table.driverId],
    foreignColumns: [drivers.tenantId, drivers.id],
  }),
  foreignKey({
    name: 'mail_outbox_vehicle_fk',
    columns: [table.tenantId, table.vehicleId],
    foreignColumns: [vehicles.tenantId, vehicles.id],
  }),
  check('mail_outbox_kind', sql`${table.kind} in ('work_order', 'invitation')`),
  check('mail_outbox_state', sql`${table.state} in ('pending', 'sent', 'failed', 'stale')`),
  check('mail_outbox_attempt_count', sql`${table.attemptCount} between 0 and 4`),
  check(
    'mail_outbox_shape',
    sql`(
      ${table.kind} = 'work_order'
        and ${table.rideId} is not null
        and ${table.driverId} is not null
        and ${table.workOrderStatus} in ('assigned', 'changed', 'cancelled', 'no_longer_yours')
        and ${table.invitationId} is null
        and (${table.workOrderStatus} = 'no_longer_yours' or ${table.vehicleId} is null)
    ) or (
      ${table.kind} = 'invitation'
        and ${table.invitationId} is not null
        and ${table.rideId} is null
        and ${table.driverId} is null
        and ${table.vehicleId} is null
        and ${table.workOrderStatus} is null
    )`,
  ),
], { oneRowPerTenant: false })
