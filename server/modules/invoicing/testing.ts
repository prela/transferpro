import type { CreateSlot, InvoiceCreateGate, InvoiceStatusRead, InvoiceStornoResult, InvoicingPort, StornoDocument } from './application/port'
import { INVOICE_CREATE_LEASE_MS, INVOICE_CREATE_SPACING_MS } from './domain/invoice'

/**
 * An in-memory gate for the application tests. One Tenant has one slot.
 * A second Tenant has its own. `reserve` sets the slot before it returns,
 * so a create that is still awaiting sees the Tenant as busy. A flight
 * older than the lease is free again, matching the database gate: a
 * killed process never calls `finish`.
 */
export function memoryCreateGate(): InvoiceCreateGate {
  const slots = new Map<string, { inFlight: boolean, lastAt: number | null }>()

  function slot(tenantId: string) {
    const current = slots.get(tenantId)
    if (current)
      return current
    const created = { inFlight: false, lastAt: null as number | null }
    slots.set(tenantId, created)
    return created
  }

  return {
    async reserve(tenantId: string, now: Date): Promise<CreateSlot> {
      const current = slot(tenantId)
      const started = current.lastAt
      // No start time means the flight cannot be shown to be inside the lease.
      const stale = current.inFlight
        && (started === null || now.getTime() >= started + INVOICE_CREATE_LEASE_MS)
      if (current.inFlight && !stale)
        return { status: 'busy' }
      if (started !== null && now.getTime() < started + INVOICE_CREATE_SPACING_MS)
        return { status: 'later', at: new Date(started + INVOICE_CREATE_SPACING_MS) }
      current.inFlight = true
      current.lastAt = now.getTime()
      return { status: 'ready' }
    },
    async finish(tenantId: string) {
      const current = slots.get(tenantId)
      if (current)
        current.inFlight = false
    },
  }
}

/**
 * The fake adapter for tests and for `INVOICING=fake`. It never calls the
 * current tool. A create returns a fixed number and link. The notes it
 * was given are the invoice id, and a later find returns that invoice.
 */
/**
 * The fake adapter. `hideStorno` keeps a recorded negative invoice out of
 * find and status until `revealStorno`, so a timeout test can show the
 * status job finding it later. The default shows it at once.
 */
export function fakeInvoicingPort(options?: {
  readonly readStatus?: (toolInvoiceId: string) => Promise<InvoiceStatusRead>
  readonly stornoOutcome?: 'accepted' | 'unknown' | 'refused'
  readonly hideStorno?: boolean
}): InvoicingPort & { revealStorno: () => void } {
  const byReference = new Map<string, { toolInvoiceId: string, number: string, issuedOn: string, documentLink: string }>()
  const stornos = new Map<string, StornoDocument>()
  let sequence = 0
  let stornoSequence = 0
  let hidden = options?.hideStorno === true
  function visibleStorno(toolInvoiceId: string): StornoDocument | null {
    if (hidden)
      return null
    return stornos.get(toolInvoiceId) ?? null
  }
  return {
    revealStorno() {
      hidden = false
    },
    async create(request: { invoiceId: string }) {
      const existing = byReference.get(request.invoiceId)
      if (existing)
        return { kind: 'created' as const, invoice: existing }
      sequence += 1
      const invoice = {
        toolInvoiceId: `fake-${sequence}`,
        number: `F-${sequence}`,
        issuedOn: '2026-06-01',
        documentLink: `https://invoices.invalid/fake/${sequence}`,
      }
      byReference.set(request.invoiceId, invoice)
      return { kind: 'created' as const, invoice }
    },
    async findByReference(invoiceId: string) {
      return byReference.get(invoiceId) ?? null
    },
    /**
     * Unsent, and no storno, unless the test passes its own read or this
     * fake has already recorded a visible negative invoice.
     */
    async readStatus(toolInvoiceId: string): Promise<InvoiceStatusRead> {
      if (options?.readStatus)
        return options.readStatus(toolInvoiceId)
      const storno = visibleStorno(toolInvoiceId)
      return {
        sent: false,
        storno: storno
          ? { number: storno.number, documentLink: storno.documentLink, sent: storno.sent }
          : null,
      }
    },
    async storno(toolInvoiceId: string): Promise<InvoiceStornoResult> {
      if (options?.stornoOutcome === 'refused')
        return { kind: 'refused', reason: 'rejected' }
      if (!stornos.has(toolInvoiceId)) {
        stornoSequence += 1
        stornos.set(toolInvoiceId, {
          number: `S-${stornoSequence}`,
          documentLink: `https://invoices.invalid/storno/${stornoSequence}`,
          sent: false,
        })
      }
      if (options?.stornoOutcome === 'unknown')
        return { kind: 'unknown' }
      return { kind: 'accepted' }
    },
    async findStorno(toolInvoiceId: string) {
      return visibleStorno(toolInvoiceId)
    },
  }
}
