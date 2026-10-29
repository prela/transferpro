import type { InvoiceReason } from '../../../../shared'

/**
 * What the current tool returns for one create, or for a lookup by our
 * reference. The adapter hides the tool. Tests use the fake in testing.ts.
 */

export interface ToolInvoice {
  readonly toolInvoiceId: string
  readonly number: string
  readonly issuedOn: string
  readonly documentLink: string
}

export type InvoiceCreateResult
  = | { readonly kind: 'created', readonly invoice: ToolInvoice }
    | { readonly kind: 'unknown' }
    | { readonly kind: 'transient' }
    | { readonly kind: 'refused', readonly reason: Exclude<InvoiceReason, 'unavailable'> }

/** The request the port sends. Notes are our invoice id (ADR-0051). */
export interface InvoiceCreateRequest {
  readonly invoiceId: string
  readonly clientId: string
  readonly lineText: string
  readonly language: 'hr' | 'en'
  readonly dueDays: number
  readonly vatRate: number
  readonly grossAmount: string
  readonly quantity: 1
  readonly buyerType: 'b2b'
  readonly buyer: {
    readonly legalName: string
    readonly country: string
    readonly oib: string | null
    readonly vatId: string | null
    readonly address: string
  }
}

export interface InvoicingPort {
  create: (request: InvoiceCreateRequest) => Promise<InvoiceCreateResult>
  findByReference: (invoiceId: string) => Promise<ToolInvoice | null>
}

export type CreateSlot
  = | { readonly status: 'ready' }
    | { readonly status: 'busy' }
    | { readonly status: 'later', readonly at: Date }

/**
 * One create in flight per Tenant, and at least ten seconds after that
 * Tenant's last create. Two Tenants do not share a slot.
 */
export interface InvoiceCreateGate {
  reserve: (tenantId: string, now: Date) => Promise<CreateSlot>
  finish: (tenantId: string, now: Date) => Promise<void>
}
