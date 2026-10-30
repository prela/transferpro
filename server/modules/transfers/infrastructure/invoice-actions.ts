import type { TransferInvoice } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { TransferInputError } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import {
  beginInvoiceStorno,
  finishInvoiceWithdraw,
  INVOICE_STORNO_QUEUE,
  InvoiceAdminOnlyError,
  InvoiceNotCancellableError,
  InvoiceNotWithdrawableError,
  invoicingMode,
  invoicingPort,
  readFailedInvoiceForWithdraw,
  withdrawFailedInvoice,
} from '../../invoicing'
import { withOfficeWrite } from '../../tenancy'
import { InvoicingNotReadyError } from '../application/issue-invoice'
import { mailOutboxQueue } from './mail-outbox-worker'
import { TransferNotFoundError } from './transfer-errors'

/**
 * Storno and withdraw from the Ride detail (ADR-0051). Both are Admin
 * only. A refusal writes no row, audit entry, or job. The storno call
 * itself is the job, after this transaction commits. Withdraw looks the
 * invoice up before it writes, outside the transaction.
 */

const emptyBody = z.strictObject({})

function parseEmpty(transferId: unknown, body: unknown): string {
  const id = z.uuid().safeParse(transferId)
  const payload = body === undefined ? { success: true as const } : emptyBody.safeParse(body)
  if (!id.success || !payload.success)
    throw new TransferInputError()
  return id.data
}

async function requireTransfer(transaction: TenantTransaction, transferId: string): Promise<void> {
  const selected = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await transaction.execute(sql`
    select id from app.transfers where id = ${transferId} for update
  `))
  if (!selected.rows[0])
    throw new TransferNotFoundError()
}

function passthrough(error: unknown): boolean {
  return error instanceof TransferInputError
    || error instanceof TransferNotFoundError
    || error instanceof InvoiceAdminOnlyError
    || error instanceof InvoiceNotCancellableError
    || error instanceof InvoiceNotWithdrawableError
    || error instanceof InvoicingNotReadyError
}

/** POST /api/transfers/:id/invoice/storno. Admin only. The job calls the tool once. */
export function stornoTransferInvoice(headers: Headers, transferId: unknown, body: unknown): Promise<TransferInvoice> {
  return withOfficeWrite(headers, body, raw => parseEmpty(transferId, raw), async ({ actor, transaction }, id) => {
    return hideDatabaseError(async () => {
      if (actor.role !== 'admin')
        throw new InvoiceAdminOnlyError()
      await requireTransfer(transaction, id)
      const invoice = await beginInvoiceStorno(transaction, id, actor.userId)
      if (!invoice)
        throw new InvoiceNotCancellableError()
      const queue = await mailOutboxQueue()
      await queue.enqueue(
        { tenantId: actor.context.tenantId },
        transaction,
        INVOICE_STORNO_QUEUE,
        { invoiceId: invoice.id },
      )
      return invoice
    }, 'Invoice storno failed', { passthrough })
  })
}

/**
 * POST /api/transfers/:id/invoice/withdraw. The lookup commits nothing.
 * When the tool has the invoice it becomes created, and no withdrawn
 * entry is written. When the tool has none, the invoice is withdrawn.
 */
export async function withdrawTransferInvoice(headers: Headers, transferId: unknown, body: unknown): Promise<TransferInvoice> {
  const prepared = await withOfficeWrite(headers, body, raw => parseEmpty(transferId, raw), async ({ actor, transaction }, id) => {
    return hideDatabaseError(async () => {
      if (actor.role !== 'admin')
        throw new InvoiceAdminOnlyError()
      await requireTransfer(transaction, id)
      const failed = await readFailedInvoiceForWithdraw(transaction, id)
      if (!failed)
        throw new InvoiceNotWithdrawableError()
      return { role: actor.role, actorUserId: actor.userId, invoice: failed }
    }, 'Invoice withdraw failed', { passthrough })
  })
  if (invoicingMode() !== 'fake')
    throw new InvoicingNotReadyError()
  return withdrawFailedInvoice(prepared.role, prepared.actorUserId, prepared.invoice, invoicingPort(), {
    async adopt(invoiceId, found) {
      return withOfficeWrite(headers, body, raw => parseEmpty(transferId, raw), async ({ transaction }) => {
        const saved = await finishInvoiceWithdraw(transaction, invoiceId, prepared.actorUserId, prepared.invoice.transferReference, found)
        if (!saved)
          throw new InvoiceNotWithdrawableError()
        return saved
      })
    },
    async withdraw(invoiceId, actorUserId, transferReference) {
      return withOfficeWrite(headers, body, raw => parseEmpty(transferId, raw), async ({ transaction }) => {
        const saved = await finishInvoiceWithdraw(transaction, invoiceId, actorUserId, transferReference, null)
        if (!saved)
          throw new InvoiceNotWithdrawableError()
        return saved
      })
    },
  })
}
