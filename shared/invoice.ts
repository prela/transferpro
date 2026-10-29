import { z } from 'zod'

/**
 * One invoice for one Transfer (ADR-0051, ADR-0053). The screen sees the
 * state, the tool's number, and the document link. The line, the amount,
 * and the buyer stay off this view.
 */

export const INVOICE_STATES = [
  'requested',
  'created',
  'sent',
  'failed',
  'cancelling',
  'cancelled',
  'withdrawn',
] as const

export const invoiceStateSchema = z.enum(INVOICE_STATES)

export type InvoiceState = z.infer<typeof invoiceStateSchema>

/** A locking invoice holds the Client, the price, and the payment (ADR-0051). */
export const LOCKING_INVOICE_STATES = ['requested', 'created', 'sent', 'cancelling'] as const

export function invoiceLocksTransfer(state: InvoiceState): boolean {
  return (LOCKING_INVOICE_STATES as readonly InvoiceState[]).includes(state)
}

export const INVOICE_REASONS = ['rejected', 'allowance', 'token', 'unavailable'] as const

export const invoiceReasonSchema = z.enum(INVOICE_REASONS)

export type InvoiceReason = z.infer<typeof invoiceReasonSchema>

/**
 * What the Ride detail shows. Null number and link until the tool returns
 * them. A reason is set only when the invoice is failed.
 */
export const transferInvoiceSchema = z.object({
  id: z.uuid(),
  state: invoiceStateSchema,
  number: z.string().min(1).nullable(),
  documentLink: z.string().min(1).nullable(),
  reason: invoiceReasonSchema.nullable(),
}).refine(invoice => invoice.state === 'failed' || invoice.reason === null)

export type TransferInvoice = z.infer<typeof transferInvoiceSchema>

/**
 * A done Ride paid by invoice to agency, with a price above zero, and no
 * open invoice. An extra vehicle is never invoiced (ADR-0053). A price of
 * 0 is never invoiced. The filter "Za fakturiranje" uses this.
 */
export function transferAwaitingInvoice(ride: {
  readonly state: string
  readonly payment: string
  readonly price: string
  readonly mainTransferId: string | null
  readonly invoice: TransferInvoice | null
}): boolean {
  if (ride.state !== 'done' || ride.payment !== 'invoice_to_agency')
    return false
  if (ride.mainTransferId !== null)
    return false
  const cents = Number(ride.price)
  if (!Number.isFinite(cents) || cents <= 0)
    return false
  return ride.invoice === null
}
