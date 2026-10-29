/**
 * Invoicing module. Callers import this file, not the infrastructure files.
 * The module owns the token and the invoicing settings (ADR-0051). It may
 * import clients. It does not import transfers (ADR-0018, ADR-0036).
 */
export { InvoicingKeyMissingError } from './domain/token-cipher'
export { readInvoicingSettings, writeInvoicingSettings } from './infrastructure/settings-access'
