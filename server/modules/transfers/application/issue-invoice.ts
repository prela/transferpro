import type { InvoiceState, InvoicingVatRate, PaymentMethod, RideState, TransferInvoice } from '../../../../shared'
import { calendarDateInTimeZone, invoiceLocksTransfer, officeGroupPassengerCount } from '../../../../shared'
import { invoiceLanguage, invoiceLineText } from '../../invoicing'

/**
 * Whether the office may issue, and the request it stores. A refusal
 * writes nothing. A Transfer that already has an open invoice returns
 * that invoice (ADR-0051, ADR-0053, ADR-0054).
 */

export class TransferNotInvoiceableError extends Error {
  readonly statusCode = 409
  readonly code = 'not_invoiceable'

  constructor() {
    super('Conflict')
    this.name = 'TransferNotInvoiceableError'
  }
}

export class ClientNotInvoiceableError extends Error {
  readonly statusCode = 409
  readonly code = 'client_not_invoiceable'

  constructor() {
    super('Conflict')
    this.name = 'ClientNotInvoiceableError'
  }
}

export class BillingDetailsMissingError extends Error {
  readonly statusCode = 409
  readonly code = 'billing_details_missing'
  readonly clientId: string

  constructor(clientId: string) {
    super('Conflict')
    this.name = 'BillingDetailsMissingError'
    this.clientId = clientId
  }
}

export class InvoicingNotReadyError extends Error {
  readonly statusCode = 409
  readonly code = 'invoicing_not_ready'

  constructor() {
    super('Conflict')
    this.name = 'InvoicingNotReadyError'
  }
}

export class InvoiceOfficeOnlyError extends Error {
  readonly statusCode = 403

  constructor() {
    super('Forbidden')
    this.name = 'InvoiceOfficeOnlyError'
  }
}

export interface IssueTransferFacts {
  readonly id: string
  readonly state: RideState
  readonly payment: PaymentMethod
  readonly price: string
  readonly mainTransferId: string | null
  readonly clientId: string
  readonly pickupAt: string
  readonly startName: string
  readonly endName: string
  readonly passengerCount: number
  readonly groupPassengerCount: number | null
  readonly clientReference: string | null
  readonly guestName: string
  readonly timeZone: string
}

export interface IssueClientFacts {
  readonly kind: 'agency' | 'hotel' | 'individual'
}

export interface IssueBillingFacts {
  readonly complete: boolean
  readonly country: string | null
  readonly guestNameOnInvoice: boolean
}

export interface IssueSettingsFacts {
  readonly tokenSet: boolean
  readonly dueDays: number
  readonly vatRate: InvoicingVatRate
  readonly lineText: string
}

export interface IssueInvoiceDraft {
  readonly id: string
  readonly transferReference: string
  readonly clientId: string
  readonly lineText: string
  readonly language: 'hr' | 'en'
  readonly dueDays: number
  readonly vatRate: number
  readonly grossAmount: string
  readonly askedBy: string
}

export interface IssueInvoiceSink {
  insertRequested: (draft: IssueInvoiceDraft) => Promise<TransferInvoice>
  enqueue: (invoiceId: string) => Promise<void>
  auditRequested: (invoiceId: string, transferReference: string, actorUserId: string) => Promise<void>
  replaceRequested: (draft: IssueInvoiceDraft) => Promise<TransferInvoice>
}

function office(role: string): void {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new InvoiceOfficeOnlyError()
}

function priceAboveZero(price: string): boolean {
  const amount = Number(price)
  return Number.isFinite(amount) && amount > 0
}

/**
 * The checks that refuse before anything is written. The same checks apply
 * to a retry, which rebuilds the request from the Transfer as it is now.
 */
export function assertInvoiceable(
  role: string,
  adapter: 'none' | 'fake' | 'current',
  transfer: IssueTransferFacts,
  client: IssueClientFacts,
  billing: IssueBillingFacts,
  settings: IssueSettingsFacts,
): void {
  office(role)
  if (transfer.mainTransferId !== null || transfer.payment !== 'invoice_to_agency' || transfer.state !== 'done' || !priceAboveZero(transfer.price))
    throw new TransferNotInvoiceableError()
  if (client.kind !== 'agency' && client.kind !== 'hotel')
    throw new ClientNotInvoiceableError()
  if (!billing.complete || billing.country === null)
    throw new BillingDetailsMissingError(transfer.clientId)
  // `current` has no adapter until #442. Only `fake` may issue.
  if (adapter !== 'fake' || !settings.tokenSet)
    throw new InvoicingNotReadyError()
}

function draftFor(
  transfer: IssueTransferFacts,
  billing: IssueBillingFacts,
  settings: IssueSettingsFacts,
  actorUserId: string,
  invoiceId: string,
): IssueInvoiceDraft {
  const language = invoiceLanguage(billing.country ?? '')
  const passengers = officeGroupPassengerCount(transfer.mainTransferId, transfer.groupPassengerCount, transfer.passengerCount)
  return {
    id: invoiceId,
    transferReference: transfer.id,
    clientId: transfer.clientId,
    lineText: invoiceLineText({
      lineText: settings.lineText,
      startName: transfer.startName,
      endName: transfer.endName,
      pickupDate: calendarDateInTimeZone(transfer.timeZone, new Date(transfer.pickupAt)),
      passengerCount: passengers ?? transfer.passengerCount,
      language,
      clientReference: transfer.clientReference,
      guestName: billing.guestNameOnInvoice ? transfer.guestName : null,
    }),
    language,
    dueDays: settings.dueDays,
    vatRate: settings.vatRate,
    grossAmount: transfer.price,
    askedBy: actorUserId,
  }
}

/**
 * Issue, or return the invoice this Transfer already has. The sink runs
 * inside the caller's transaction: the row, the audit entry, and the job.
 */
export async function issueInvoice(
  role: string,
  adapter: 'none' | 'fake' | 'current',
  actorUserId: string,
  transfer: IssueTransferFacts,
  client: IssueClientFacts,
  billing: IssueBillingFacts,
  settings: IssueSettingsFacts,
  openInvoice: TransferInvoice | null,
  sink: IssueInvoiceSink,
  newId: () => string,
): Promise<TransferInvoice> {
  office(role)
  if (openInvoice)
    return openInvoice
  assertInvoiceable(role, adapter, transfer, client, billing, settings)
  const draft = draftFor(transfer, billing, settings, actorUserId, newId())
  const invoice = await sink.insertRequested(draft)
  await sink.auditRequested(invoice.id, transfer.id, actorUserId)
  await sink.enqueue(invoice.id)
  return invoice
}

/**
 * "Pokušaj ponovno" on a failed invoice. The Transfer is checked again.
 * The same invoice id keeps the tool's reference.
 */
export async function retryInvoice(
  role: string,
  adapter: 'none' | 'fake' | 'current',
  actorUserId: string,
  transfer: IssueTransferFacts,
  client: IssueClientFacts,
  billing: IssueBillingFacts,
  settings: IssueSettingsFacts,
  openInvoice: TransferInvoice | null,
  sink: IssueInvoiceSink,
): Promise<TransferInvoice> {
  office(role)
  if (!openInvoice || openInvoice.state !== 'failed')
    throw new TransferNotInvoiceableError()
  assertInvoiceable(role, adapter, transfer, client, billing, settings)
  const draft = draftFor(transfer, billing, settings, actorUserId, openInvoice.id)
  const invoice = await sink.replaceRequested(draft)
  await sink.auditRequested(invoice.id, transfer.id, actorUserId)
  await sink.enqueue(invoice.id)
  return invoice
}

/**
 * A locking invoice refuses a change of the Client, the price, or the
 * payment. A failed invoice does not. Other fields stay editable.
 */
export function correctionBlockedByInvoice(
  invoice: { readonly state: InvoiceState } | null,
  fields: readonly string[],
): boolean {
  if (!invoice || !invoiceLocksTransfer(invoice.state))
    return false
  return fields.some(field => field === 'clientId' || field === 'price' || field === 'payment')
}
