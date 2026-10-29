import type { InvoiceState, TransferInvoice } from '../../../../shared'
import type { JobQueue, Logger, QueuedJob, TenantTransaction } from '../../../core/index'
import type { InvoiceCreateStore } from '../application/create'
import type { InvoicingPort } from '../application/port'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { invoiceReasonSchema, invoiceStateSchema, transferInvoiceSchema } from '../../../../shared'
import { getLogger } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError, loadClientBillingForInvoice } from '../../clients'
import { performInvoiceCreate } from '../application/create'
import { INVOICE_CREATE_SPACING_MS } from '../domain/invoice'
import { fakeInvoicingPort } from '../testing'
import { invoicingMode } from './mode'

/** The only payload is the invoice id (ADR-0035). */
export const INVOICE_CREATE_QUEUE = 'invoice-create'

const jobData = z.object({ invoiceId: z.uuid() })

const openRow = z.object({
  id: z.uuid(),
  state: invoiceStateSchema,
  number: z.string().nullable(),
  documentLink: z.string().nullable(),
  reason: invoiceReasonSchema.nullable(),
})

const jobRow = z.object({
  id: z.uuid(),
  transferReference: z.uuid(),
  state: invoiceStateSchema,
  clientId: z.uuid(),
  lineText: z.string(),
  language: z.enum(['hr', 'en']),
  dueDays: z.number().int(),
  vatRate: z.number().int(),
  grossAmount: z.union([z.string(), z.number()]),
  attemptCount: z.number().int(),
  awaitingLookup: z.boolean(),
  askedBy: z.string().min(1),
})

function money(value: string | number): string {
  if (typeof value === 'number')
    return value.toFixed(2)
  return value
}

function toJob(row: z.infer<typeof jobRow>) {
  return {
    id: row.id,
    transferReference: row.transferReference,
    state: row.state,
    clientId: row.clientId,
    lineText: row.lineText,
    language: row.language,
    dueDays: row.dueDays,
    vatRate: row.vatRate,
    grossAmount: money(row.grossAmount),
    attemptCount: row.attemptCount,
    awaitingLookup: row.awaitingLookup,
    askedBy: row.askedBy,
  }
}

const jobColumns = sql`
  id,
  transfer_reference as "transferReference",
  state,
  client_id as "clientId",
  line_text as "lineText",
  language,
  due_days as "dueDays",
  vat_rate as "vatRate",
  gross_amount as "grossAmount",
  attempt_count as "attemptCount",
  awaiting_lookup as "awaitingLookup",
  asked_by as "askedBy"
`

/**
 * The open invoice for this Transfer, locked. Cancelled and withdrawn are
 * not open. A miss is null. Transfers calls this before a correction.
 */
export async function lockOpenInvoice(
  transaction: TenantTransaction,
  transferReference: string,
): Promise<{ state: InvoiceState } | null> {
  const selected = z.object({
    rows: z.array(z.object({ state: invoiceStateSchema })),
  }).parse(await transaction.execute(sql`
    select state
    from app.invoices
    where transfer_reference = ${transferReference}
      and state not in ('cancelled', 'withdrawn')
    for update
  `))
  return selected.rows[0] ?? null
}

/** The open invoice as the Ride detail shows it. A miss is null. */
export async function readOpenInvoice(
  transaction: TenantTransaction,
  transferReference: string,
): Promise<TransferInvoice | null> {
  const selected = z.object({ rows: z.array(openRow) }).parse(await transaction.execute(sql`
    select id, state,
      invoice_number as "number",
      document_link as "documentLink",
      reason
    from app.invoices
    where transfer_reference = ${transferReference}
      and state not in ('cancelled', 'withdrawn')
  `))
  const row = selected.rows[0]
  if (!row)
    return null
  return transferInvoiceSchema.parse(row)
}

async function audit(
  transaction: TenantTransaction,
  action: 'invoice.requested' | 'invoice.issued' | 'invoice.failed',
  actorUserId: string,
  invoiceId: string,
  transferId: string,
): Promise<void> {
  await appendAuditEntry(transaction, {
    action,
    actorUserId,
    subjectUserId: null,
    data: { invoiceId, transferId },
  })
}

function createStore(transaction: TenantTransaction): InvoiceCreateStore {
  return {
    async load(invoiceId) {
      const selected = z.object({ rows: z.array(jobRow) }).parse(await transaction.execute(sql`
        select ${jobColumns} from app.invoices where id = ${invoiceId}
      `))
      const row = selected.rows[0]
      return row ? toJob(row) : null
    },
    async beginAttempt(invoiceId) {
      // The increment commits with this transaction, before the port returns.
      // A crash rolls the increment back with the call. #442 can split them.
      const updated = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await transaction.execute(sql`
        update app.invoices
        set attempt_count = attempt_count + 1, updated_at = now()
        where id = ${invoiceId} and state = 'requested'
        returning id
      `))
      if (!updated.rows[0])
        return null
      return this.load(invoiceId)
    },
    async saveCreated(invoiceId, invoice, actorUserId, transferReference) {
      await transaction.execute(sql`
        update app.invoices
        set state = 'created',
            tool_invoice_id = ${invoice.toolInvoiceId},
            invoice_number = ${invoice.number},
            issued_on = ${invoice.issuedOn},
            document_link = ${invoice.documentLink},
            awaiting_lookup = false,
            next_attempt_at = null,
            reason = null,
            updated_at = now()
        where id = ${invoiceId}
      `)
      await audit(transaction, 'invoice.issued', actorUserId, invoiceId, transferReference)
    },
    async saveRetry(invoiceId, awaitingLookup, nextAttemptAt) {
      await transaction.execute(sql`
        update app.invoices
        set awaiting_lookup = ${awaitingLookup},
            next_attempt_at = ${nextAttemptAt.toISOString()},
            updated_at = now()
        where id = ${invoiceId}
      `)
    },
    async saveFailed(invoiceId, reason, actorUserId, transferReference) {
      await transaction.execute(sql`
        update app.invoices
        set state = 'failed',
            reason = ${reason},
            awaiting_lookup = false,
            next_attempt_at = null,
            updated_at = now()
        where id = ${invoiceId}
      `)
      await audit(transaction, 'invoice.failed', actorUserId, invoiceId, transferReference)
    },
    async loadBuyer(clientId) {
      try {
        const billing = await loadClientBillingForInvoice(transaction, clientId)
        if (!billing.complete || billing.legalName === null || billing.country === null || billing.address === null)
          return null
        return {
          legalName: billing.legalName,
          country: billing.country,
          oib: billing.oib,
          vatId: billing.vatId,
          address: billing.address,
        }
      }
      catch (error) {
        if (error instanceof ClientNotFoundError)
          return null
        throw error
      }
    },
  }
}

let sharedFake: InvoicingPort | undefined

/** One fake for this process. Tests and E2E never call the current tool. */
export function invoicingPort(): InvoicingPort {
  // `current` stays on the fake until #442 supplies the real adapter.
  sharedFake ??= fakeInvoicingPort()
  return sharedFake
}

const gateRow = z.object({
  inFlight: z.boolean(),
  lastCreateAt: z.unknown().nullable(),
})

function instant(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  if (value instanceof Date)
    return value
  if (typeof value === 'string')
    return new Date(value)
  return null
}

/**
 * Reserve this Tenant's create slot. The row lock is held by the caller's
 * transaction until it commits, so a second job for the same Tenant waits.
 */
export async function reserveCreateSlot(
  transaction: TenantTransaction,
  now: Date,
): Promise<{ status: 'ready' } | { status: 'busy' } | { status: 'later', at: Date }> {
  await transaction.execute(sql`
    insert into app.invoicing_create_gate (in_flight)
    values (false)
    on conflict (tenant_id) do nothing
  `)
  const selected = z.object({ rows: z.array(gateRow) }).parse(await transaction.execute(sql`
    select in_flight as "inFlight", last_create_at as "lastCreateAt"
    from app.invoicing_create_gate
    for update
  `))
  const row = selected.rows[0]
  if (!row)
    return { status: 'busy' }
  if (row.inFlight)
    return { status: 'busy' }
  const last = instant(row.lastCreateAt)
  if (last && now.getTime() < last.getTime() + INVOICE_CREATE_SPACING_MS)
    return { status: 'later', at: new Date(last.getTime() + INVOICE_CREATE_SPACING_MS) }
  await transaction.execute(sql`
    update app.invoicing_create_gate
    set in_flight = true, last_create_at = ${now.toISOString()}
  `)
  return { status: 'ready' }
}

/** Store the requested invoice. Transfers calls this; it does not write the table. */
export async function insertRequestedInvoice(
  transaction: TenantTransaction,
  draft: {
    id: string
    transferReference: string
    clientId: string
    lineText: string
    language: 'hr' | 'en'
    dueDays: number
    vatRate: number
    grossAmount: string
    askedBy: string
  },
): Promise<void> {
  await transaction.execute(sql`
    insert into app.invoices (
      id, transfer_reference, state, client_id, line_text, language,
      due_days, vat_rate, gross_amount, asked_by
    )
    values (
      ${draft.id}, ${draft.transferReference}, 'requested', ${draft.clientId},
      ${draft.lineText}, ${draft.language}, ${draft.dueDays}, ${draft.vatRate},
      ${draft.grossAmount}, ${draft.askedBy}
    )
  `)
}

/** A failed invoice is requested again under the same id. The attempt count starts over. */
export async function replaceFailedInvoice(
  transaction: TenantTransaction,
  draft: {
    id: string
    clientId: string
    lineText: string
    language: 'hr' | 'en'
    dueDays: number
    vatRate: number
    grossAmount: string
    askedBy: string
  },
): Promise<void> {
  await transaction.execute(sql`
    update app.invoices
    set state = 'requested',
        client_id = ${draft.clientId},
        line_text = ${draft.lineText},
        language = ${draft.language},
        due_days = ${draft.dueDays},
        vat_rate = ${draft.vatRate},
        gross_amount = ${draft.grossAmount},
        asked_by = ${draft.askedBy},
        reason = null,
        attempt_count = 0,
        awaiting_lookup = false,
        next_attempt_at = null,
        updated_at = now()
    where id = ${draft.id} and state = 'failed'
  `)
}

/** Open invoices for these Transfers. A miss is absent from the map. */
export async function readOpenInvoicesForTransfers(
  transaction: TenantTransaction,
  transferIds: readonly string[],
): Promise<Map<string, TransferInvoice>> {
  const found = new Map<string, TransferInvoice>()
  if (transferIds.length === 0)
    return found
  const ids = sql.join(transferIds.map(id => sql`${id}`), sql`, `)
  const selected = z.object({
    rows: z.array(openRow.extend({ transferReference: z.uuid() })),
  }).parse(await transaction.execute(sql`
    select
      transfer_reference as "transferReference",
      id, state,
      invoice_number as "number",
      document_link as "documentLink",
      reason
    from app.invoices
    where transfer_reference in (${ids})
      and state not in ('cancelled', 'withdrawn')
  `))
  for (const row of selected.rows) {
    found.set(row.transferReference, transferInvoiceSchema.parse({
      id: row.id,
      state: row.state,
      number: row.number,
      documentLink: row.documentLink,
      reason: row.reason,
    }))
  }
  return found
}

export async function finishCreateSlot(transaction: TenantTransaction): Promise<void> {
  await transaction.execute(sql`
    update app.invoicing_create_gate set in_flight = false
  `)
}

/**
 * One job. The attempt update is ordered before the port call. It commits
 * with the outcome, the same way the mail outbox does (ADR-0051 cites that
 * schedule). A crash rolls the increment back and the queue retries. The
 * log line is the invoice id, the state, the reason, and the attempt count.
 */
export async function handleInvoiceCreateJob(
  job: QueuedJob,
  transaction: TenantTransaction,
  queue: JobQueue,
  log: Logger = getLogger(),
): Promise<void> {
  const { invoiceId } = jobData.parse(job.data)
  // A process left on `none` does not call out. The fake is the only adapter here.
  if (invoicingMode() === 'none')
    return
  await performInvoiceCreate(
    job.tenantId,
    invoiceId,
    new Date(),
    invoicingPort(),
    {
      reserve: (_tenantId, now) => reserveCreateSlot(transaction, now),
      finish: () => finishCreateSlot(transaction),
    },
    createStore(transaction),
    {
      later: async (id, startAfter) => {
        await queue.enqueue({ tenantId: job.tenantId }, transaction, INVOICE_CREATE_QUEUE, { invoiceId: id }, { startAfter })
      },
    },
    log,
  )
}

let starting: Promise<void> | undefined

/** Worker for `invoice-create`. The queue is the process queue the mail outbox already holds. */
export function startInvoiceCreateWorker(queue: JobQueue, log: Logger = getLogger()): Promise<void> {
  starting ??= queue.work(INVOICE_CREATE_QUEUE, async (job, scope) => {
    await handleInvoiceCreateJob(job, scope.transaction, queue, log)
  }).then(() => undefined)
  return starting
}
