import type { WorkOrderStatus } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { OutboxAttemptPatch, OutboxAttemptStore } from '../application/attempt'
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

/**
 * Write one pending invitation on the caller's tenant transaction (ADR-0045).
 * The row holds the invitation id only. The address, the role, and the
 * Tenant name are read at each attempt. `nextAttemptAt` is when the job
 * queued with this row may run. The id is a bearer secret: no error carries it.
 */
export async function recordInvitation(
  transaction: TenantTransaction,
  invitationId: string,
  nextAttemptAt: Date,
): Promise<string> {
  const parsed = z.object({ invitationId: z.uuid(), nextAttemptAt: z.date() }).safeParse({ invitationId, nextAttemptAt })
  if (!parsed.success)
    throw new Error('Mail outbox write failed')
  const inserted = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    insert into app.mail_outbox (kind, invitation_id, state, attempt_count, next_attempt_at)
    values ('invitation', ${parsed.data.invitationId}, 'pending', 0, ${parsed.data.nextAttemptAt})
    returning id
  `), 'Mail outbox write failed'))
  const id = inserted.rows[0]?.id
  if (id === undefined)
    throw new Error('Mail outbox write failed')
  return id
}

/** The update that settles one attempt, for any kind. A row that is no longer pending is a fixed error. */
export async function saveOutboxAttempt(
  transaction: TenantTransaction,
  entryId: string,
  patch: OutboxAttemptPatch,
): Promise<void> {
  const id = z.uuid().parse(entryId)
  const updated = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.mail_outbox
    set state = ${patch.state},
        attempt_count = ${patch.attemptCount},
        next_attempt_at = ${patch.nextAttemptAt}
    where id = ${id}
      and state = 'pending'
    returning id
  `), 'Mail outbox update failed'))
  if (updated.rows[0] === undefined)
    throw new Error('Mail outbox update failed')
}

export type OutboxKind = 'work_order' | 'invitation'

/**
 * A manual resend settles a failed row of this kind. The attempt count stays:
 * the column stops at 4, and a resend does not start the retry cycle. A row
 * that is no longer failed is a fixed error, so two clicks cannot both send.
 */
export async function settleFailedOutboxEntry(
  transaction: TenantTransaction,
  kind: OutboxKind,
  entryId: string,
  state: 'sent' | 'stale',
): Promise<void> {
  const id = z.uuid().parse(entryId)
  const next = z.enum(['sent', 'stale']).parse(state)
  const updated = insertedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.mail_outbox
    set state = ${next},
        next_attempt_at = null
    where id = ${id}
      and kind = ${kind}
      and state = 'failed'
    returning id
  `), 'Mail outbox update failed'))
  if (updated.rows[0] === undefined)
    throw new Error('Mail outbox update failed')
}

const deletedRows = z.object({ rowCount: z.number().int().nonnegative() })

/**
 * Delete this Tenant's entries created before `before`, in every state (ADR-0045).
 * The caller's transaction already holds the tenant session, so the row policy
 * keeps every other Tenant's entries out of reach. Returns the count only.
 */
export async function deleteOutboxEntriesBefore(transaction: TenantTransaction, before: Date): Promise<number> {
  const cutoff = z.date().parse(before)
  const deleted = deletedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    delete from app.mail_outbox where created_at < ${cutoff}
  `), 'Mail outbox delete failed'))
  return deleted.rowCount
}

const kindRows = z.object({
  rows: z.array(z.object({ kind: z.enum(['work_order', 'invitation']) })),
})

/** The kind of one entry in this Tenant. Another Tenant's id is null, the same as a missing one. */
export async function readOutboxKind(transaction: TenantTransaction, entryId: string): Promise<OutboxKind | null> {
  const id = z.uuid().safeParse(entryId)
  if (!id.success)
    return null
  const parsed = kindRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    select kind from app.mail_outbox where id = ${id.data}
  `), 'Mail outbox read failed'))
  return parsed.rows[0]?.kind ?? null
}

/**
 * One store for the worker. The kind decides which reader composes the mail.
 * The save is the same update for both kinds.
 */
export function outboxStoreByKind(
  transaction: TenantTransaction,
  stores: Readonly<Record<OutboxKind, OutboxAttemptStore>>,
): OutboxAttemptStore {
  return {
    async load(entryId) {
      const kind = await readOutboxKind(transaction, entryId)
      return kind === null ? null : stores[kind].load(entryId)
    },
    save: (entryId, patch) => saveOutboxAttempt(transaction, entryId, patch),
  }
}
