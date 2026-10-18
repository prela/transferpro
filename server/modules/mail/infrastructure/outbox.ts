import type { WorkOrderStatus } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { WORK_ORDER_STATUSES } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'

/**
 * A work order recorded on the Ride's transaction (ADR-0045).
 * A blank Driver email is not an entry: the action reports no email, as before.
 * The address is not stored. The body is composed later, from the snapshot
 * read on this same transaction, so the table never holds it.
 * `vehicleId` is the Vehicle a "no longer yours" mail released. Other
 * statuses store null. The plate and the name stay off the row.
 */
export interface WorkOrderEntry {
  readonly rideId: string
  readonly driverId: string
  readonly vehicleId: string | null
  readonly status: WorkOrderStatus
  readonly email: string | null
}

const workOrderEntry = z.object({
  rideId: z.uuid(),
  driverId: z.uuid(),
  vehicleId: z.uuid().nullable(),
  status: z.enum(WORK_ORDER_STATUSES),
  email: z.string().nullable(),
})

const insertedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/**
 * Write one pending work order on the caller's transaction.
 * A rollback of that transaction leaves no row. A blank address writes nothing
 * and returns null. The attempt count stays 0 until the first send.
 * `nextAttemptAt` is when the queued job may run. Null leaves that column empty.
 */
export async function recordWorkOrder(
  transaction: TenantTransaction,
  entry: WorkOrderEntry,
  nextAttemptAt: Date | null = null,
): Promise<string | null> {
  const parsed = workOrderEntry.parse(entry)
  const address = parsed.email?.trim() ?? ''
  if (address === '')
    return null
  const inserted = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    insert into app.mail_outbox (
      kind, ride_id, driver_id, vehicle_id, work_order_status, state, attempt_count, next_attempt_at
    )
    values (
      'work_order', ${parsed.rideId}, ${parsed.driverId}, ${parsed.vehicleId}, ${parsed.status}, 'pending', 0, ${nextAttemptAt}
    )
    returning id
  `), 'Mail outbox write failed'))
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('Mail outbox write failed')
  return id
}

const attemptResult = z.enum(['sent', 'pending'])

/**
 * Count the attempt that just finished. `sent` stops the entry and clears
 * the next time, so the queued job finds nothing to send. `pending` keeps
 * the next time written with the row: the job from that insert is the retry.
 * A missing pending row is a fixed error, so a bound id cannot leave on a
 * database message.
 */
export async function noteWorkOrderAttempt(
  transaction: TenantTransaction,
  entryId: string,
  result: 'sent' | 'pending',
): Promise<void> {
  const id = z.uuid().parse(entryId)
  const state = attemptResult.parse(result)
  const updated = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.mail_outbox
    set state = ${state},
        attempt_count = attempt_count + 1,
        next_attempt_at = case when ${state} = 'sent' then null else next_attempt_at end
    where id = ${id}
      and state = 'pending'
    returning id
  `), 'Mail outbox update failed'))
  if (updated.rows[0] === undefined)
    throw new Error('Mail outbox update failed')
}

/**
 * The attempt found the mail no longer current. The count stays: nothing was sent.
 * The next time is cleared so a queued job finds a row that is not pending.
 * A missing pending row is the same fixed error as a counted attempt.
 */
export async function markWorkOrderStale(
  transaction: TenantTransaction,
  entryId: string,
): Promise<void> {
  const id = z.uuid().parse(entryId)
  const updated = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.mail_outbox
    set state = 'stale',
        next_attempt_at = null
    where id = ${id}
      and state = 'pending'
    returning id
  `), 'Mail outbox update failed'))
  if (updated.rows[0] === undefined)
    throw new Error('Mail outbox update failed')
}
