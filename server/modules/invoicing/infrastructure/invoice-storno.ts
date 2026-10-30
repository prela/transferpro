import type { TransferInvoice } from '../../../../shared'
import type { JobQueue, Logger, QueuedJob, TenantTransaction } from '../../../core/index'
import type { ToolInvoice } from '../application/port'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { invoiceStateSchema, transferInvoiceSchema } from '../../../../shared'
import { getLogger } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { performInvoiceStorno } from '../application/storno'
import { invoicingPort } from './invoice-job'
import { invoicingMode } from './mode'

/** The only payload is the invoice id (ADR-0035). */
export const INVOICE_STORNO_QUEUE = 'invoice-storno'

const jobData = z.object({ invoiceId: z.uuid() })

const stornoRow = z.object({
  id: z.uuid(),
  state: invoiceStateSchema,
  toolInvoiceId: z.string().nullable(),
  stornoCalled: z.boolean(),
})

const lockedRow = z.object({
  id: z.uuid(),
  state: invoiceStateSchema,
  transferReference: z.uuid(),
  number: z.string().nullable(),
  documentLink: z.string().nullable(),
  reason: z.string().nullable(),
  stornoNumber: z.string().nullable(),
  stornoLink: z.string().nullable(),
})

function viewOf(row: z.infer<typeof lockedRow>): TransferInvoice {
  return transferInvoiceSchema.parse({
    id: row.id,
    state: row.state,
    number: row.number,
    documentLink: row.documentLink,
    reason: row.state === 'failed' ? row.reason : null,
    stornoNumber: row.stornoNumber,
    stornoLink: row.stornoLink,
  })
}

/** One committed tenant transaction. The port call stays between steps. */
export type InvoiceStornoStep = <T>(run: (transaction: TenantTransaction) => Promise<T>) => Promise<T>

/**
 * The created or sent invoice becomes cancelling, and the audit entry is
 * the ask. Null when this Transfer has no such invoice: nothing is written.
 */
export async function beginInvoiceStorno(
  transaction: TenantTransaction,
  transferReference: string,
  actorUserId: string,
): Promise<TransferInvoice | null> {
  const updated = z.object({ rows: z.array(lockedRow) }).parse(await transaction.execute(sql`
    update app.invoices
    set state = 'cancelling',
        updated_at = now()
    where transfer_reference = ${transferReference}
      and state in ('created', 'sent')
    returning
      id,
      state,
      transfer_reference as "transferReference",
      invoice_number as "number",
      document_link as "documentLink",
      reason,
      storno_number as "stornoNumber",
      storno_link as "stornoLink"
  `))
  const row = updated.rows[0]
  if (!row)
    return null
  await appendAuditEntry(transaction, {
    action: 'invoice.cancelled',
    actorUserId,
    subjectUserId: null,
    data: { invoiceId: row.id, transferId: row.transferReference },
  })
  return viewOf(row)
}

/** The failed invoice for this Transfer, locked. Null when there is none. */
export async function readFailedInvoiceForWithdraw(
  transaction: TenantTransaction,
  transferReference: string,
): Promise<{ id: string, transferReference: string, state: 'failed' } | null> {
  const selected = z.object({
    rows: z.array(z.object({
      id: z.uuid(),
      transferReference: z.uuid(),
      state: z.literal('failed'),
    })),
  }).parse(await transaction.execute(sql`
    select id, transfer_reference as "transferReference", state
    from app.invoices
    where transfer_reference = ${transferReference}
      and state = 'failed'
    for update
  `))
  return selected.rows[0] ?? null
}

/**
 * Adopt the tool's invoice, or withdraw when the tool has none.
 * Null when the row is no longer failed: a retry won the race.
 * Adopting writes no audit entry.
 */
export async function finishInvoiceWithdraw(
  transaction: TenantTransaction,
  invoiceId: string,
  actorUserId: string,
  transferReference: string,
  found: ToolInvoice | null,
): Promise<TransferInvoice | null> {
  if (found) {
    const adopted = z.object({ rows: z.array(lockedRow) }).parse(await transaction.execute(sql`
      update app.invoices
      set state = 'created',
          tool_invoice_id = ${found.toolInvoiceId},
          invoice_number = ${found.number},
          issued_on = ${found.issuedOn},
          document_link = ${found.documentLink},
          reason = null,
          awaiting_lookup = false,
          next_attempt_at = null,
          updated_at = now()
      where id = ${invoiceId} and state = 'failed'
      returning
        id, state,
        transfer_reference as "transferReference",
        invoice_number as "number",
        document_link as "documentLink",
        reason,
        storno_number as "stornoNumber",
        storno_link as "stornoLink"
    `))
    const row = adopted.rows[0]
    return row ? viewOf(row) : null
  }
  const withdrawn = z.object({ rows: z.array(lockedRow) }).parse(await transaction.execute(sql`
    update app.invoices
    set state = 'withdrawn',
        reason = null,
        updated_at = now()
    where id = ${invoiceId} and state = 'failed'
    returning
      id, state,
      transfer_reference as "transferReference",
      invoice_number as "number",
      document_link as "documentLink",
      reason,
      storno_number as "stornoNumber",
      storno_link as "stornoLink"
  `))
  const row = withdrawn.rows[0]
  if (!row)
    return null
  await appendAuditEntry(transaction, {
    action: 'invoice.withdrawn',
    actorUserId,
    subjectUserId: null,
    data: { invoiceId: row.id, transferId: transferReference },
  })
  return viewOf({ ...row, reason: null })
}

export async function handleInvoiceStornoJob(
  job: QueuedJob,
  step: InvoiceStornoStep,
  log: Logger = getLogger(),
): Promise<void> {
  const { invoiceId } = jobData.parse(job.data)
  if (invoicingMode() !== 'fake')
    return
  const port = invoicingPort()
  await performInvoiceStorno(invoiceId, port, {
    async load(id) {
      return step(async (transaction) => {
        const selected = z.object({ rows: z.array(stornoRow) }).parse(await transaction.execute(sql`
          select id, state, tool_invoice_id as "toolInvoiceId", storno_called as "stornoCalled"
          from app.invoices
          where id = ${id}
        `))
        return selected.rows[0] ?? null
      })
    },
    async markCalled(id) {
      return step(async (transaction) => {
        const updated = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await transaction.execute(sql`
          update app.invoices
          set storno_called = true,
              updated_at = now()
          where id = ${id}
            and state = 'cancelling'
            and storno_called = false
          returning id
        `))
        return updated.rows[0] !== undefined
      })
    },
    async saveCancelled(id, storno) {
      await step(async (transaction) => {
        await transaction.execute(sql`
          update app.invoices
          set state = 'cancelled',
              storno_number = ${storno.number},
              storno_link = ${storno.documentLink},
              storno_sent = ${storno.sent},
              updated_at = now()
          where id = ${id} and state = 'cancelling'
        `)
      })
    },
  }, log)
}

let starting: Promise<void> | undefined

/** Worker for `invoice-storno`. The flag commits before the port is called. */
export function startInvoiceStornoWorker(queue: JobQueue, log: Logger = getLogger()): Promise<void> {
  const workInSteps = queue.workInSteps
  if (workInSteps === undefined)
    throw new Error('invoice-storno needs a queue that commits each step.')
  starting ??= workInSteps(INVOICE_STORNO_QUEUE, async (job, step) => {
    await handleInvoiceStornoJob(job, step, log)
  }).then(() => undefined)
  return starting
}
