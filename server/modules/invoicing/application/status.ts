import type { InvoiceStatusCandidate, InvoiceStatusEffect } from '../domain/invoice'
import type { InvoiceStatusRead } from './port'
import { invoiceStatusEffect, statusReadsThisRun } from '../domain/invoice'

/**
 * One Tenant's status run. The caller passes that Tenant's rows, oldest
 * checked first. This takes twenty and calls the port once each. A second
 * Tenant is a second call, so the budgets do not add together (ADR-0051).
 * The log is the invoice id and the state. The tool's number and link
 * stay on the effect, for the store, and off the line.
 */

export interface InvoiceStatusLog {
  info: (obj: Record<string, unknown>, msg?: string) => void
}

export async function applyInvoiceStatusReads(input: {
  readonly candidates: readonly InvoiceStatusCandidate[]
  readonly port: { readStatus: (toolInvoiceId: string) => Promise<InvoiceStatusRead> }
  readonly log: InvoiceStatusLog
}): Promise<InvoiceStatusEffect[]> {
  const effects: InvoiceStatusEffect[] = []
  for (const candidate of statusReadsThisRun(input.candidates)) {
    const read = await input.port.readStatus(candidate.toolInvoiceId)
    const effect = invoiceStatusEffect(candidate, read)
    effects.push(effect)
    input.log.info({ invoiceId: effect.id, state: effect.state }, 'invoice status')
  }
  return effects
}
