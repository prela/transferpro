/**
 * Mail outbox. Callers import this file, not the infrastructure files.
 * A work order is recorded on the Ride's transaction and sent after that
 * commit. An invitation is recorded after Better Auth created it, and the
 * invite call waits for its first attempt. Retries read the current rows.
 * The row holds the kind and the ids, never an address, a name, or a body (ADR-0045).
 */
export { enqueueMailOutboxJob, entryIsCurrent, firstOutboxAttempt, handleMailOutboxJob, MAIL_OUTBOX_QUEUE, OutboxComposeError } from './application/attempt'
export type { FirstAttemptOutcome, LoadedInvitationEntry, LoadedOutboxEntry, LoadedWorkOrderEntry, OutboxAttemptPatch, OutboxAttemptStore, OutboxMessage, OutboxSender } from './application/attempt'
export { deliverNewInvitation } from './application/invitation'
export { resendFailedOutboxEntry } from './application/resend'
export type { FailedMailResendOutcome, FailedMailResendStore } from './application/resend'
export { failedWorkOrderMatters, invitationIsCurrent, workOrderIsCurrent } from './domain/current'
export type { InvitationCurrentFacts, WorkOrderCurrentFacts } from './domain/current'
export { mailIdempotencyKey } from './domain/idempotency-key'
export { MAIL_RETRY_DELAYS_MS } from './domain/retry'
export { invitationAttemptStore, loadInvitationAttempt } from './infrastructure/invitation-attempt'
export type { InvitationReader } from './infrastructure/invitation-attempt'
export { invitationMailOutbox } from './infrastructure/invitation-outbox'
export { markWorkOrderStale, noteWorkOrderAttempt, outboxStoreByKind, readOutboxKind, recordInvitation, recordWorkOrder, saveOutboxAttempt, settleFailedOutboxEntry } from './infrastructure/outbox'
export type { OutboxKind, WorkOrderEntry } from './infrastructure/outbox'
export { closeMailOutboxQueue, mailOutboxQueue } from './infrastructure/queue'
