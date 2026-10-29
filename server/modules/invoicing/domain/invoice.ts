import type { InvoiceReason, InvoiceState } from '../../../../shared'

/**
 * The request and the line the current tool is asked to create (ADR-0051,
 * ADR-0054). Invoicing does not know a Transfer. The caller passes the
 * pieces. The notes the tool sees are the invoice id, set when the id exists.
 */

/** Creates for one Tenant stay at least this far apart (ADR-0051). */
export const INVOICE_CREATE_SPACING_MS = 10_000

/**
 * Wait after a failed attempt, in order: 1 minute, 5 minutes, 30 minutes.
 * The fourth failure has no next wait. The invoice is then failed.
 * Same schedule as the mail outbox (ADR-0045, ADR-0051).
 */
export const INVOICE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const

/** Four tries in all. The check on the row is the same bound. */
export const INVOICE_MAX_ATTEMPTS = 4

/** A Croatian Client is invoiced in Croatian. Every other Client is English. */
export function invoiceLanguage(country: string): 'hr' | 'en' {
  return country === 'HR' ? 'hr' : 'en'
}

/**
 * The passenger word on the line. One is singular. Every other count uses
 * the Croatian form that covers both the 2–4 and the 5+ groups, which are
 * the same word for this noun, and the English plural.
 */
function passengerWord(count: number, language: 'hr' | 'en'): string {
  if (language === 'hr')
    return count === 1 ? 'putnik' : 'putnika'
  return count === 1 ? 'passenger' : 'passengers'
}

export interface InvoiceLineInput {
  readonly lineText: string
  readonly startName: string
  readonly endName: string
  /** Calendar date in the Tenant time zone, `YYYY-MM-DD`. */
  readonly pickupDate: string
  /** The group's ordered passenger count. Not a vehicle count (ADR-0054). */
  readonly passengerCount: number
  readonly language: 'hr' | 'en'
  readonly clientReference: string | null
  /** Set only when the billing details ask for the guest name. */
  readonly guestName: string | null
}

/**
 * One line of text. The parts are the Tenant's line text, "start – end",
 * the pickup date, the ordered passenger count, the Client reference when
 * there is one, and the guest name only when it was asked for.
 */
export function invoiceLineText(input: InvoiceLineInput): string {
  const parts = [
    input.lineText,
    `${input.startName} – ${input.endName}`,
    input.pickupDate,
    `${input.passengerCount} ${passengerWord(input.passengerCount, input.language)}`,
  ]
  if (input.clientReference !== null && input.clientReference !== '')
    parts.push(input.clientReference)
  if (input.guestName !== null && input.guestName !== '')
    parts.push(input.guestName)
  return parts.join(', ')
}

export interface InvoiceDraft {
  readonly id: string
  readonly transferReference: string
  readonly clientId: string
  readonly lineText: string
  readonly language: 'hr' | 'en'
  readonly dueDays: number
  readonly vatRate: number
  /** Gross, the Transfer price, two decimals. Quantity is 1. Buyer is B2B. */
  readonly grossAmount: string
  readonly quantity: 1
  readonly buyerType: 'b2b'
}

/**
 * Delay before the next create after `attemptCount` attempts that did not
 * succeed. Null when there is no further try.
 */
export function retryDelayAfterAttempt(attemptCount: number): number | null {
  if (attemptCount < 1 || attemptCount > INVOICE_RETRY_DELAYS_MS.length)
    return null
  return INVOICE_RETRY_DELAYS_MS[attemptCount - 1] ?? null
}

/** A refusal fails at once. A transient miss may wait. */
export function refusalReason(kind: 'rejected' | 'allowance' | 'token'): InvoiceReason {
  return kind
}

export function isInvoiceState(value: string): value is InvoiceState {
  return value === 'requested'
    || value === 'created'
    || value === 'sent'
    || value === 'failed'
    || value === 'cancelling'
    || value === 'cancelled'
    || value === 'withdrawn'
}
