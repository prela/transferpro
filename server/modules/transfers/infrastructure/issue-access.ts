import type { TransferInvoice } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { IssueInvoiceDraft } from '../application/issue-invoice'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { paymentMethodSchema, rideStateSchema, TransferInputError } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError, loadClient, loadClientBillingDetails } from '../../clients'
import { insertRequestedInvoice, INVOICE_CREATE_QUEUE, invoicingMode, readInvoicingReadiness, readOpenInvoice, replaceFailedInvoice } from '../../invoicing'
import { loadLocation } from '../../locations'
import { loadTenantSettings, withOfficeWrite } from '../../tenancy'
import {
  BillingDetailsMissingError,
  ClientNotInvoiceableError,
  InvoiceOfficeOnlyError,
  InvoicingNotReadyError,
  issueInvoice,
  retryInvoice,
  TransferNotInvoiceableError,
} from '../application/issue-invoice'
import { mailOutboxQueue } from './mail-outbox-worker'
import { TransferNotFoundError } from './transfer-errors'
import { toPrice } from './transfers'

/**
 * Issue an invoice for a done Transfer, or retry a failed one (ADR-0051).
 * The row, the audit entry, and the job commit together. A refusal writes
 * none of them. The tenant id is the session's.
 */

const emptyBody = z.strictObject({})

const lockedRow = z.object({
  id: z.uuid(),
  state: z.string(),
  payment: z.string(),
  price: z.union([z.string(), z.number()]),
  mainTransferId: z.uuid().nullable(),
  clientId: z.uuid(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int(),
  groupPassengerCount: z.number().int().nullable(),
  clientReference: z.string().nullable(),
  guestName: z.string(),
})

function parseEmpty(transferId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(transferId)
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new TransferInputError()
  return id.data
}

function instant(value: unknown): string {
  if (value instanceof Date)
    return value.toISOString()
  if (typeof value === 'string')
    return new Date(value).toISOString()
  throw new TransferNotFoundError()
}

async function lockTransfer(transaction: TenantTransaction, transferId: string) {
  const selected = z.object({ rows: z.array(lockedRow) }).parse(await transaction.execute(sql`
    select
      t.id,
      r.state,
      t.payment,
      t.price,
      t.link as "mainTransferId",
      t.client_id as "clientId",
      t.pickup_at as "pickupAt",
      t.start_location_id as "startLocationId",
      t.end_location_id as "endLocationId",
      t.passenger_count as "passengerCount",
      t.group_passenger_count as "groupPassengerCount",
      t.client_reference as "clientReference",
      t.guest_name as "guestName"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where t.id = ${transferId}
    for update of t
  `))
  return selected.rows[0]
}

/**
 * The open invoice, if this Transfer has one. Read after the Transfer lock
 * so a second press sees the row the first press inserted.
 */
function requestedView(id: string): TransferInvoice {
  return { id, state: 'requested', number: null, documentLink: null, reason: null, stornoNumber: null, stornoLink: null }
}

async function runIssue(
  headers: Headers,
  transferId: unknown,
  body: unknown,
  kind: 'issue' | 'retry',
): Promise<TransferInvoice> {
  return withOfficeWrite(headers, body, raw => parseEmpty(transferId, raw), async ({ actor, transaction }, id) => {
    return hideDatabaseError(async () => {
      if (actor.role !== 'admin' && actor.role !== 'dispatcher')
        throw new InvoiceOfficeOnlyError()
      const row = await lockTransfer(transaction, id)
      if (!row)
        throw new TransferNotFoundError()
      const open = await readOpenInvoice(transaction, id)
      const client = await loadClient(transaction, row.clientId)
      const billing = await loadClientBillingDetails(transaction, row.clientId, actor.role)
      const settings = await readInvoicingReadiness(transaction, actor.role)
      const tenant = await loadTenantSettings(transaction)
      const start = await loadLocation(transaction, row.startLocationId)
      const end = await loadLocation(transaction, row.endLocationId)
      const facts = {
        id: row.id,
        state: rideStateSchema.parse(row.state),
        payment: paymentMethodSchema.parse(row.payment),
        price: toPrice(row.price),
        mainTransferId: row.mainTransferId,
        clientId: row.clientId,
        pickupAt: instant(row.pickupAt),
        startName: start.name,
        endName: end.name,
        passengerCount: row.passengerCount,
        groupPassengerCount: row.groupPassengerCount,
        clientReference: row.clientReference,
        guestName: row.guestName,
        timeZone: tenant.timeZone,
      }
      const queue = await mailOutboxQueue()
      const sink = {
        async insertRequested(draft: IssueInvoiceDraft) {
          await insertRequestedInvoice(transaction, draft)
          return requestedView(draft.id)
        },
        async replaceRequested(draft: IssueInvoiceDraft) {
          await replaceFailedInvoice(transaction, draft)
          return requestedView(draft.id)
        },
        async auditRequested(invoiceId: string, transferReference: string, actorUserId: string) {
          await appendAuditEntry(transaction, {
            action: 'invoice.requested',
            actorUserId,
            subjectUserId: null,
            data: { invoiceId, transferId: transferReference },
          })
        },
        async enqueue(invoiceId: string) {
          await queue.enqueue(
            { tenantId: actor.context.tenantId },
            transaction,
            INVOICE_CREATE_QUEUE,
            { invoiceId },
          )
        },
      }
      const shared = [
        actor.role,
        invoicingMode(),
        actor.userId,
        facts,
        { kind: client.kind },
        { complete: billing.complete, country: billing.country, guestNameOnInvoice: billing.guestNameOnInvoice },
        settings,
        open,
        sink,
      ] as const
      if (kind === 'issue')
        return issueInvoice(...shared, randomUUID)
      return retryInvoice(...shared)
    }, 'Invoice issue failed', {
      passthrough: error => error instanceof TransferInputError
        || error instanceof TransferNotFoundError
        || error instanceof ClientNotFoundError
        || error instanceof InvoiceOfficeOnlyError
        || error instanceof TransferNotInvoiceableError
        || error instanceof ClientNotInvoiceableError
        || error instanceof BillingDetailsMissingError
        || error instanceof InvoicingNotReadyError,
    })
  })
}

/** POST /api/transfers/:id/invoice. A repeat returns the invoice already stored. */
export function issueTransferInvoice(headers: Headers, transferId: unknown, body: unknown): Promise<TransferInvoice> {
  return runIssue(headers, transferId, body, 'issue')
}

/** POST /api/transfers/:id/invoice/retry. A failed invoice is requested again under the same id. */
export function retryTransferInvoice(headers: Headers, transferId: unknown, body: unknown): Promise<TransferInvoice> {
  return runIssue(headers, transferId, body, 'retry')
}
