/**
 * Mail outbox. Callers import this file, not the infrastructure files.
 * A work order is recorded on the Ride's transaction and sent after that
 * commit. An invitation joins in a later ticket. The row holds the kind and
 * the ids, never an address, a name, or a body (ADR-0045).
 */
export { noteWorkOrderAttempt, recordWorkOrder } from './infrastructure/outbox'
export type { WorkOrderEntry } from './infrastructure/outbox'
