import type { InvoiceReason, InvoiceState } from '../../../../shared'
import type { InvoiceCreateGate, InvoiceCreateRequest, InvoicingPort, ToolInvoice } from './port'
import { retryDelayAfterAttempt } from '../domain/invoice'

/**
 * One create. The attempt is recorded before the port is called. An unknown
 * outcome is looked up by our reference before another create. A refusal
 * fails at once. A transient miss waits 1, 5, then 30 minutes (ADR-0051).
 */

export interface InvoiceJobRow {
  readonly id: string
  readonly transferReference: string
  readonly state: InvoiceState
  readonly clientId: string
  readonly lineText: string
  readonly language: 'hr' | 'en'
  readonly dueDays: number
  readonly vatRate: number
  readonly grossAmount: string
  readonly attemptCount: number
  readonly awaitingLookup: boolean
  readonly askedBy: string
}

export interface InvoiceCreateStore {
  load: (invoiceId: string) => Promise<InvoiceJobRow | null>
  /** Increments the attempt and returns the row. Null when it is not `requested`. */
  beginAttempt: (invoiceId: string) => Promise<InvoiceJobRow | null>
  saveCreated: (invoiceId: string, invoice: ToolInvoice, actorUserId: string, transferReference: string) => Promise<void>
  saveRetry: (invoiceId: string, awaitingLookup: boolean, nextAttemptAt: Date) => Promise<void>
  saveFailed: (
    invoiceId: string,
    reason: InvoiceReason,
    actorUserId: string,
    transferReference: string,
  ) => Promise<void>
  loadBuyer: (clientId: string) => Promise<InvoiceCreateRequest['buyer'] | null>
}

export interface InvoiceLog {
  info: (obj: Record<string, unknown>, msg?: string) => void
}

export interface InvoiceEnqueue {
  later: (invoiceId: string, startAfter: Date) => Promise<void>
}

const BUSY_WAIT_MS = 1_000

function requestFrom(row: InvoiceJobRow, buyer: InvoiceCreateRequest['buyer']): InvoiceCreateRequest {
  return {
    invoiceId: row.id,
    clientId: row.clientId,
    lineText: row.lineText,
    language: row.language,
    dueDays: row.dueDays,
    vatRate: row.vatRate,
    grossAmount: row.grossAmount,
    quantity: 1,
    buyerType: 'b2b',
    buyer,
  }
}

function logOutcome(log: InvoiceLog, invoiceId: string, state: InvoiceState, reason: InvoiceReason | null, attemptCount: number): void {
  // The number, the amount, the buyer, and the link stay off the line (ADR-0051).
  log.info({ invoiceId, state, reason, attemptCount }, 'invoice create')
}

/**
 * Run one `invoice-create` job. A missing row, or a row that is no longer
 * requested, does nothing. The gate is released after the call, including
 * when the call throws.
 */
export async function performInvoiceCreate(
  tenantId: string,
  invoiceId: string,
  now: Date,
  port: InvoicingPort,
  gate: InvoiceCreateGate,
  store: InvoiceCreateStore,
  enqueue: InvoiceEnqueue,
  log: InvoiceLog,
): Promise<void> {
  const loaded = await store.load(invoiceId)
  if (!loaded || loaded.state !== 'requested')
    return

  const slot = await gate.reserve(tenantId, now)
  if (slot.status === 'busy') {
    await enqueue.later(invoiceId, new Date(now.getTime() + BUSY_WAIT_MS))
    return
  }
  if (slot.status === 'later') {
    await enqueue.later(invoiceId, slot.at)
    return
  }

  try {
    const row = await store.beginAttempt(invoiceId)
    if (!row)
      return

    const adopted = row.awaitingLookup ? await port.findByReference(row.id) : null
    if (adopted) {
      await store.saveCreated(row.id, adopted, row.askedBy, row.transferReference)
      logOutcome(log, row.id, 'created', null, row.attemptCount)
      return
    }

    const buyer = await store.loadBuyer(row.clientId)
    if (!buyer) {
      await store.saveFailed(row.id, 'rejected', row.askedBy, row.transferReference)
      logOutcome(log, row.id, 'failed', 'rejected', row.attemptCount)
      return
    }

    const result = await port.create(requestFrom(row, buyer))
    if (result.kind === 'created') {
      await store.saveCreated(row.id, result.invoice, row.askedBy, row.transferReference)
      logOutcome(log, row.id, 'created', null, row.attemptCount)
      return
    }
    if (result.kind === 'unknown') {
      const found = await port.findByReference(row.id)
      if (found) {
        await store.saveCreated(row.id, found, row.askedBy, row.transferReference)
        logOutcome(log, row.id, 'created', null, row.attemptCount)
        return
      }
    }
    if (result.kind === 'refused') {
      await store.saveFailed(row.id, result.reason, row.askedBy, row.transferReference)
      logOutcome(log, row.id, 'failed', result.reason, row.attemptCount)
      return
    }

    const delay = retryDelayAfterAttempt(row.attemptCount)
    if (delay === null) {
      await store.saveFailed(row.id, 'unavailable', row.askedBy, row.transferReference)
      logOutcome(log, row.id, 'failed', 'unavailable', row.attemptCount)
      return
    }
    const next = new Date(now.getTime() + delay)
    await store.saveRetry(row.id, result.kind === 'unknown', next)
    await enqueue.later(row.id, next)
    logOutcome(log, row.id, 'requested', null, row.attemptCount)
  }
  finally {
    await gate.finish(tenantId, now)
  }
}
