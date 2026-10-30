import type { InvoiceState, TransferInvoice } from '../../../../shared'
import type { InvoicingPort, ToolInvoice } from './port'
import { InvoiceAdminOnlyError } from './storno'

/**
 * Withdraw a failed invoice, or adopt it when the current tool already
 * has one for our reference. The lookup happens before either write.
 * Adopting appends nothing: the invoice was not withdrawn (ADR-0051).
 */

export class InvoiceNotWithdrawableError extends Error {
  readonly statusCode = 409
  readonly code = 'invoice_not_withdrawable'

  constructor() {
    super('Conflict')
    this.name = 'InvoiceNotWithdrawableError'
  }
}

export interface WithdrawInvoiceRow {
  readonly id: string
  readonly state: InvoiceState
  readonly transferReference: string
}

export interface InvoiceWithdrawStore {
  adopt: (invoiceId: string, invoice: ToolInvoice) => Promise<TransferInvoice>
  withdraw: (invoiceId: string, actorUserId: string, transferReference: string) => Promise<TransferInvoice>
}

export async function withdrawFailedInvoice(
  role: string,
  actorUserId: string,
  invoice: WithdrawInvoiceRow | null,
  port: Pick<InvoicingPort, 'findByReference'>,
  store: InvoiceWithdrawStore,
): Promise<TransferInvoice> {
  if (role !== 'admin')
    throw new InvoiceAdminOnlyError()
  if (!invoice || invoice.state !== 'failed')
    throw new InvoiceNotWithdrawableError()
  const found = await port.findByReference(invoice.id)
  if (found)
    return store.adopt(invoice.id, found)
  return store.withdraw(invoice.id, actorUserId, invoice.transferReference)
}
