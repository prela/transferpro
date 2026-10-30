import type { InvoiceReason, InvoiceState } from '../../../../shared'
import { calendarDateInTimeZone } from '../../../../shared'

/**
 * The request and the line the current tool is asked to create (ADR-0051,
 * ADR-0054). Invoicing does not know a Transfer. The caller passes the
 * pieces. The notes the tool sees are the invoice id, set when the id exists.
 */

/** Creates for one Tenant stay at least this far apart (ADR-0051). */
export const INVOICE_CREATE_SPACING_MS = 10_000

/**
 * How long one create may hold the Tenant's slot.
 * `last_create_at` is written in the same update as `in_flight`, and that
 * update commits before the port call, so the column is the start of the
 * call. One run may call the port twice (a create, then a lookup). The
 * real adapter has to abort each call within 30 seconds. Two minutes
 * covers both calls twice over, so a live call finishes before another
 * run takes the slot. The queue reclaims a job after 15 minutes, so a
 * killed process, which never runs `finish`, frees the Tenant before that
 * retry. A shorter lease would let a second run create while the first
 * call was still out.
 */
export const INVOICE_CREATE_LEASE_MS = 120_000

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

/** Reads of invoice status in one Tenant in one run (ADR-0051). */
export const INVOICE_STATUS_BUDGET = 20

/** The status tick. Fifteen minutes keeps the tool's hourly read allowance. */
export const INVOICE_STATUS_EVERY_MINUTES = 15

export interface InvoiceStatusCandidate {
  readonly id: string
  readonly state: 'created' | 'cancelling' | 'cancelled'
  readonly toolInvoiceId: string
}

/** An Admin may cancel a created or sent invoice. Any other state is refused. */
export function stornoRequestAllowed(state: InvoiceState): boolean {
  return state === 'created' || state === 'sent'
}

/** An Admin may withdraw only a failed invoice, and only after a lookup. */
export function withdrawRequestAllowed(state: InvoiceState): boolean {
  return state === 'failed'
}

/**
 * What one read changes. `sent` is only from `created`. A storno number
 * and link are stored only when `cancelling` finds the negative invoice.
 * An unchanged row is returned as its current state so the caller can
 * stamp the check without a second decision.
 */
export type InvoiceStatusEffect
  = { readonly id: string, readonly state: 'created' | 'cancelling' | 'sent' | 'cancelled' }
    | {
      readonly id: string
      readonly state: 'cancelled'
      readonly stornoSent: true
    }
    | {
      readonly id: string
      readonly state: 'cancelled'
      readonly stornoNumber: string
      readonly stornoLink: string
      /** False until the office sends the negative invoice from the current tool. */
      readonly stornoSent: boolean
    }

/** The first `INVOICE_STATUS_BUDGET` rows. The caller orders oldest checked first. */
export function statusReadsThisRun<T>(rows: readonly T[]): T[] {
  return rows.slice(0, INVOICE_STATUS_BUDGET)
}

export function invoiceStatusEffect(
  candidate: InvoiceStatusCandidate,
  read: {
    readonly sent: boolean
    readonly storno: { readonly number: string, readonly documentLink: string, readonly sent?: boolean } | null
  },
): InvoiceStatusEffect {
  if (candidate.state === 'created' && read.sent)
    return { id: candidate.id, state: 'sent' }
  if (candidate.state === 'cancelling' && read.storno !== null) {
    return {
      id: candidate.id,
      state: 'cancelled',
      stornoNumber: read.storno.number,
      stornoLink: read.storno.documentLink,
      stornoSent: read.storno.sent === true,
    }
  }
  // A cancelled storno stays an unsent warning until the tool says it was sent.
  if (candidate.state === 'cancelled' && read.storno?.sent === true)
    return { id: candidate.id, state: 'cancelled', stornoSent: true }
  return { id: candidate.id, state: candidate.state }
}

/**
 * The payment-reporting reminder. The 15th and the 20th are included,
 * in the Tenant's time zone, and only while a sent invoice to a Croatian
 * Client exists. The day is the calendar date, so the edges are local
 * midnight, not UTC (ADR-0051).
 */
export function paymentReportingReminderDue(
  now: Date,
  timeZone: string,
  hasSentCroatianInvoice: boolean,
): boolean {
  if (!hasSentCroatianInvoice)
    return false
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Instant is not a valid time.')
  const day = Number(calendarDateInTimeZone(timeZone, now).slice(-2))
  return day >= 15 && day <= 20
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
