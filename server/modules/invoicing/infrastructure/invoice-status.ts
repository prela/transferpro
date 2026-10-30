import type { InvoiceState } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { InvoiceStatusCandidate, InvoiceStatusEffect } from '../domain/invoice'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { invoiceStateSchema } from '../../../../shared'
import { INVOICE_STATUS_BUDGET, paymentReportingReminderDue } from '../domain/invoice'

const candidateRow = z.object({
  id: z.uuid(),
  state: z.enum(['created', 'cancelling']),
  toolInvoiceId: z.string().min(1),
})

/**
 * Created and cancelling invoices this session may read, oldest check
 * first. A null check is first. The limit is the per-run budget. RLS
 * keeps the rows to this Tenant, so another Tenant's budget is its own run.
 */
export async function loadInvoiceStatusCandidates(
  transaction: TenantTransaction,
): Promise<InvoiceStatusCandidate[]> {
  const selected = z.object({ rows: z.array(candidateRow) }).parse(await transaction.execute(sql`
    select id, state, tool_invoice_id as "toolInvoiceId"
    from app.invoices
    where state in ('created', 'cancelling')
      and tool_invoice_id is not null
    order by status_checked_at asc nulls first, id
    limit ${INVOICE_STATUS_BUDGET}
  `))
  return selected.rows
}

/** Stamp the check. A state change is written in the same update, and only from the state the read started in. */
export async function saveInvoiceStatusEffect(
  transaction: TenantTransaction,
  effect: InvoiceStatusEffect,
  checkedAt: Date,
): Promise<void> {
  const at = checkedAt.toISOString()
  if (effect.state === 'cancelled') {
    await transaction.execute(sql`
      update app.invoices
      set state = 'cancelled',
          storno_number = ${effect.stornoNumber},
          storno_link = ${effect.stornoLink},
          status_checked_at = ${at},
          updated_at = now()
      where id = ${effect.id} and state = 'cancelling'
    `)
    return
  }
  if (effect.state === 'sent') {
    await transaction.execute(sql`
      update app.invoices
      set state = 'sent',
          status_checked_at = ${at},
          updated_at = now()
      where id = ${effect.id} and state = 'created'
    `)
    return
  }
  await transaction.execute(sql`
    update app.invoices
    set status_checked_at = ${at},
        updated_at = now()
    where id = ${effect.id} and state = ${effect.state}
  `)
}

const warningRow = z.object({
  transferReference: z.uuid(),
  state: z.enum(['created', 'failed']),
})

export interface InvoiceHomeNotice {
  readonly transferReference: string
  readonly kind: 'unsent' | 'failed'
}

/**
 * Unsent is `created`: the tool has the invoice and the office has not
 * sent it. Failed is its own warning. A sent invoice in Croatian is what
 * the reminder looks for. The language is the country at issue time.
 */
export async function readInvoiceHomeNotices(
  transaction: TenantTransaction,
  now: Date,
  timeZone: string,
): Promise<{ warnings: InvoiceHomeNotice[], paymentReportingReminder: boolean }> {
  const selected = z.object({ rows: z.array(warningRow) }).parse(await transaction.execute(sql`
    select transfer_reference as "transferReference", state
    from app.invoices
    where state in ('created', 'failed')
  `))
  const sent = z.object({
    rows: z.array(z.object({ present: z.boolean() })),
  }).parse(await transaction.execute(sql`
    select exists (
      select 1 from app.invoices
      where state = 'sent' and language = 'hr'
    ) as present
  `))
  return {
    warnings: selected.rows.map(row => ({
      transferReference: row.transferReference,
      kind: row.state === 'created' ? 'unsent' as const : 'failed' as const,
    })),
    paymentReportingReminder: paymentReportingReminderDue(now, timeZone, sent.rows[0]?.present === true),
  }
}

const stateRow = z.object({
  transferReference: z.uuid(),
  state: invoiceStateSchema,
})

/**
 * The newest invoice for each Transfer, including a cancelled one.
 * A miss means the Transfer has no invoice. Partner history does not call this.
 */
export async function readLatestInvoiceStates(
  transaction: TenantTransaction,
  transferIds: readonly string[],
): Promise<Map<string, InvoiceState>> {
  const found = new Map<string, InvoiceState>()
  if (transferIds.length === 0)
    return found
  const ids = sql.join(transferIds.map(id => sql`${id}`), sql`, `)
  const selected = z.object({ rows: z.array(stateRow) }).parse(await transaction.execute(sql`
    select distinct on (transfer_reference)
      transfer_reference as "transferReference",
      state
    from app.invoices
    where transfer_reference in (${ids})
    order by transfer_reference, created_at desc
  `))
  for (const row of selected.rows)
    found.set(row.transferReference, row.state)
  return found
}
