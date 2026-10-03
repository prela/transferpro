/**
 * Audit module (ADR-0014). Other modules append through this file, inside
 * the transaction of the action they record.
 */
export { appendAuditEntry, listAuditEntries } from './infrastructure/audit-log'
export type { AuditEntryInput } from './infrastructure/audit-log'
