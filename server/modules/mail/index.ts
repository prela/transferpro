/**
 * Mail outbox. Callers import this file, not the infrastructure files.
 * A work order is recorded on the Ride's transaction and sent after that
 * commit. Retries read the current rows. An invitation joins in a later ticket.
 * The row holds the kind and the ids, never an address, a name, or a body (ADR-0045).
 */
export { enqueueMailOutboxJob, handleMailOutboxJob, MAIL_OUTBOX_QUEUE, OutboxComposeError } from './application/attempt'
export type { LoadedOutboxEntry, OutboxAttemptPatch, OutboxAttemptStore } from './application/attempt'
export { workOrderIsCurrent } from './domain/current'
export type { WorkOrderCurrentFacts } from './domain/current'
export { workOrderIdempotencyKey } from './domain/idempotency-key'
export { MAIL_RETRY_DELAYS_MS } from './domain/retry'
export { markWorkOrderStale, noteWorkOrderAttempt, recordWorkOrder } from './infrastructure/outbox'
export type { WorkOrderEntry } from './infrastructure/outbox'
