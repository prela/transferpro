import type { CreateSlot, InvoiceCreateGate } from './application/port'
import { INVOICE_CREATE_SPACING_MS } from './domain/invoice'

/**
 * An in-memory gate for the application tests. One Tenant has one slot.
 * A second Tenant has its own. `reserve` sets the slot before it returns,
 * so a create that is still awaiting sees the Tenant as busy.
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
      if (current.inFlight)
        return { status: 'busy' }
      if (current.lastAt !== null && now.getTime() < current.lastAt + INVOICE_CREATE_SPACING_MS)
        return { status: 'later', at: new Date(current.lastAt + INVOICE_CREATE_SPACING_MS) }
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
export function fakeInvoicingPort() {
  const byReference = new Map<string, { toolInvoiceId: string, number: string, issuedOn: string, documentLink: string }>()
  let sequence = 0
  return {
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
  }
}
