import type { AppEnv } from '../../../core/index'
import { loadAppEnv } from '../../../core/index'

export type InvoicingMode = AppEnv['INVOICING']

let selected: InvoicingMode | undefined

/**
 * The adapter for this process. The first read uses the env. A test can
 * select `fake` without restarting, because the route and the job both
 * read through here.
 */
export function invoicingMode(): InvoicingMode {
  selected ??= loadAppEnv().INVOICING
  return selected
}

/** Tests select the fake. Production leaves this unset and uses the env. */
export function selectInvoicingMode(mode: InvoicingMode): void {
  selected = mode
}
