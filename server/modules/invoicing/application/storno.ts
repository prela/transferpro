import type { InvoiceState } from '../../../../shared'
import type { InvoiceStornoResult, InvoicingPort, StornoDocument } from './port'

/**
 * One storno. The flag commits before the port is called, so a timeout
 * or a killed process cannot call the tool again. The tool returns no id
 * and does not refuse a duplicate. A miss stays `cancelling`; the status
 * job looks for the negative invoice (ADR-0051).
 */

export class InvoiceAdminOnlyError extends Error {
  readonly statusCode = 403

  constructor() {
    super('Forbidden')
    this.name = 'InvoiceAdminOnlyError'
  }
}

export class InvoiceNotCancellableError extends Error {
  readonly statusCode = 409
  readonly code = 'invoice_not_cancellable'

  constructor() {
    super('Conflict')
    this.name = 'InvoiceNotCancellableError'
  }
}

export interface InvoiceStornoRow {
  readonly id: string
  readonly state: InvoiceState
  readonly toolInvoiceId: string | null
  readonly stornoCalled: boolean
}

export interface InvoiceStornoStore {
  load: (invoiceId: string) => Promise<InvoiceStornoRow | null>
  /** Commits `storno_called` before returning. False when another run already claimed it. */
  markCalled: (invoiceId: string) => Promise<boolean>
  saveCancelled: (invoiceId: string, storno: StornoDocument) => Promise<void>
}

export interface InvoiceStornoLog {
  info: (obj: Record<string, unknown>, msg?: string) => void
}

function logStorno(
  log: InvoiceStornoLog,
  invoiceId: string,
  state: InvoiceState,
  reason: string | null,
): void {
  // The number and the link stay off the line (ADR-0051).
  log.info({ invoiceId, state, reason }, 'invoice storno')
}

/**
 * Call the tool once. A second run, including after a throw, returns
 * without calling. A refusal is logged and leaves the invoice cancelling.
 */
export async function performInvoiceStorno(
  invoiceId: string,
  port: Pick<InvoicingPort, 'storno' | 'findStorno'>,
  store: InvoiceStornoStore,
  log: InvoiceStornoLog,
): Promise<void> {
  const loaded = await store.load(invoiceId)
  if (!loaded || loaded.state !== 'cancelling' || loaded.toolInvoiceId === null || loaded.stornoCalled)
    return
  const claimed = await store.markCalled(invoiceId)
  if (!claimed)
    return

  let result: InvoiceStornoResult
  try {
    result = await port.storno(loaded.toolInvoiceId)
  }
  catch {
    // The response never came back. The tool may still have created it.
    result = { kind: 'unknown' }
  }
  if (result.kind === 'refused') {
    logStorno(log, invoiceId, 'cancelling', result.reason)
    return
  }
  const found = await port.findStorno(loaded.toolInvoiceId)
  if (found)
    await store.saveCancelled(invoiceId, found)
  logStorno(log, invoiceId, found ? 'cancelled' : 'cancelling', result.kind === 'unknown' ? 'unknown' : null)
}
