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
import { INVOICE_CREATE_LEASE_MS, INVOICE_CREATE_SPACING_MS } from '../domain/invoice'
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

/** One committed tenant transaction. The port call stays between steps. */
export type InvoiceStep = <T>(run: (transaction: TenantTransaction) => Promise<T>) => Promise<T>

function createStore(step: InvoiceStep): InvoiceCreateStore {
  return {
    async load(invoiceId) {
      return step(async (transaction) => {
        const selected = z.object({ rows: z.array(jobRow) }).parse(await transaction.execute(sql`
          select ${jobColumns} from app.invoices where id = ${invoiceId}
        `))
        const row = selected.rows[0]
        return row ? toJob(row) : null
      })
    },
    async beginAttempt(invoiceId) {
      // Commits before the caller returns, so a crash after the port call
      // still leaves the attempt and awaiting_lookup for the next run.
      return step(async (transaction) => {
        const updated = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await transaction.execute(sql`
          update app.invoices
          set attempt_count = attempt_count + 1,
              awaiting_lookup = true,
              updated_at = now()
          where id = ${invoiceId} and state = 'requested'
          returning id
        `))
        if (!updated.rows[0])
          return null
        const selected = z.object({ rows: z.array(jobRow) }).parse(await transaction.execute(sql`
          select ${jobColumns} from app.invoices where id = ${invoiceId}
        `))
        const row = selected.rows[0]
        return row ? toJob(row) : null
      })
    },
    async saveCreated(invoiceId, invoice, actorUserId, transferReference) {
      await step(async (transaction) => {
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
      })
    },
    async saveRetry(invoiceId, awaitingLookup, nextAttemptAt) {
      await step(async (transaction) => {
        await transaction.execute(sql`
        update app.invoices
        set awaiting_lookup = ${awaitingLookup},
            next_attempt_at = ${nextAttemptAt.toISOString()},
            updated_at = now()
        where id = ${invoiceId}
        `)
      })
    },
    async saveFailed(invoiceId, reason, actorUserId, transferReference) {
      await step(async (transaction) => {
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
      })
    },
    async loadBuyer(clientId) {
      return step(async (transaction) => {
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
      })
    },
  }
}

let sharedFake: InvoicingPort | undefined

/** The in-process fake. `current` has no adapter until #442, so it is refused. */
export function invoicingPort(): InvoicingPort {
  if (invoicingMode() !== 'fake')
    throw new Error('The invoicing port is only available when INVOICING is fake.')
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
  const parsed = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : null
  if (parsed === null || Number.isNaN(parsed.getTime()))
    return null
  return parsed
}

/**
 * Reserve this Tenant's create slot. The caller commits this transaction
 * before the port call, so `in_flight` and `last_create_at` are visible to
 * the next job. The row lock ends at that commit. `last_create_at` is the
 * start of the flight. A flight older than the lease is taken again: the
 * process that set `in_flight` may have been killed, and `finish` did not run.
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
  const last = instant(row.lastCreateAt)
  // A flight with no start time cannot be shown to be inside the lease.
  const stale = row.inFlight && (last === null || now.getTime() >= last.getTime() + INVOICE_CREATE_LEASE_MS)
  if (row.inFlight && !stale)
    return { status: 'busy' }
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

/**
 * The invoice the Ride shows. An open invoice wins. Otherwise the latest
 * cancelled or withdrawn invoice, so the storno number stays on the detail
 * and the Transfer can be invoiced again.
 */
export async function readOpenInvoicesForTransfers(
  transaction: TenantTransaction,
  transferIds: readonly string[],
): Promise<Map<string, TransferInvoice>> {
  const found = new Map<string, TransferInvoice>()
  if (transferIds.length === 0)
    return found
  const ids = sql.join(transferIds.map(id => sql`${id}`), sql`, `)
  const selected = z.object({
    rows: z.array(openRow.extend({
      transferReference: z.uuid(),
      stornoNumber: z.string().nullable(),
      stornoLink: z.string().nullable(),
    })),
  }).parse(await transaction.execute(sql`
    select distinct on (transfer_reference)
      transfer_reference as "transferReference",
      id, state,
      invoice_number as "number",
      document_link as "documentLink",
      reason,
      storno_number as "stornoNumber",
      storno_link as "stornoLink"
    from app.invoices
    where transfer_reference in (${ids})
    order by transfer_reference, (state in ('cancelled', 'withdrawn')), created_at desc
  `))
  for (const row of selected.rows) {
    found.set(row.transferReference, transferInvoiceSchema.parse({
      id: row.id,
      state: row.state,
      number: row.number,
      documentLink: row.documentLink,
      reason: row.reason,
      stornoNumber: row.stornoNumber,
      stornoLink: row.stornoLink,
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
 * One job. The attempt and the gate each commit before the port is called.
 * The outcome commits in a later step. `none` and `current` do not call the
 * fake. The log line is the invoice id, the state, the reason, and the
 * attempt count.
 */
export async function handleInvoiceCreateJob(
  job: QueuedJob,
  step: InvoiceStep,
  queue: JobQueue,
  log: Logger = getLogger(),
  port?: InvoicingPort,
): Promise<void> {
  const { invoiceId } = jobData.parse(job.data)
  // Checked before the default port is built, so `current` never touches the fake.
  if (invoicingMode() !== 'fake')
    return
  await performInvoiceCreate(
    job.tenantId,
    invoiceId,
    new Date(),
    port ?? invoicingPort(),
    {
      reserve: (_tenantId, now) => step(transaction => reserveCreateSlot(transaction, now)),
      finish: () => step(transaction => finishCreateSlot(transaction)),
    },
    createStore(step),
    {
      later: async (id, startAfter) => {
        await step(transaction => queue.enqueue({ tenantId: job.tenantId }, transaction, INVOICE_CREATE_QUEUE, { invoiceId: id }, { startAfter }))
      },
    },
    log,
  )
}

let starting: Promise<void> | undefined

/** Worker for `invoice-create`. Each database step commits before the port is called. */
export function startInvoiceCreateWorker(queue: JobQueue, log: Logger = getLogger()): Promise<void> {
  const workInSteps = queue.workInSteps
  if (workInSteps === undefined)
    throw new Error('invoice-create needs a queue that commits each step.')
  starting ??= workInSteps(INVOICE_CREATE_QUEUE, async (job, step) => {
    await handleInvoiceCreateJob(job, step, queue, log)
  }).then(() => undefined)
  return starting
}
