# 329 Mail retry

Out of scope: the Home "Neuspjeli mailovi" block, "Pošalji ponovno", invitations through the outbox, and the 90-day delete (#330–#332).

## Decisions

- The Ride transaction writes the entry and enqueues the job for one minute later. After a failure the waits are 1, 5, and 30 minutes. At most four sends. Success is `sent`. The last failure is `failed`.
- Damir, 18.10.: a work order is stale when the Ride is `done` or `no-show`, or when a newer work order for the same Ride and the same Driver was recorded after it. Pickup time is not a criterion. A cancelled Ride stales assigned and changed mail. It does not stale "no longer yours" or the cancellation notice.
- Rows written in one transaction share `created_at` and do not replace each other. A reassign still sends both mails.
- A stale first attempt returns `stale` to the office. The sentence names the Driver.
- A compose failure counts as an attempt and queues the next job. A load that throws logs `{ event: 'mail_outbox.attempt_failed', entryId }` and lets pg-boss retry. A failed current-ness read logs `{ event: 'mail_outbox.current_check_failed', entryId }`.
- A "no longer yours" retry reads the released Vehicle from `mail_outbox.vehicle_id`.
- The Resend call sends `Idempotency-Key` and aborts after 15 seconds. `409 concurrent_idempotent_requests` counts as an attempt.
- `pnpm test:rls` on the dev database `transferpro` fails only `refuses an assigned work order that names a vehicle`, because the local `mail_outbox_shape` check is older than migration `0045`. The two new same-driver tests passed locally. CI `slow` builds the database from scratch.
- `origin/develop` was already contained in this branch.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (673). `pnpm test:e2e` passed: 272 (3.6m), database `transferpro_e2e` only. `pnpm audit --audit-level=high` exited 0.

## Code review

Fixed point `origin/develop`. The reports below are that review.

### Standards

## Hard

**`AGENTS.md` (UI change adds or extends an `e2e/` spec).** `TransferDay.vue` and `TransferRideDetail.vue` now render `stale` through `workOrderNotice`, and both locales gained `ride.workOrderStale`. No spec under `e2e/` was added or extended. Existing work-order specs still cover only no-email and the retry sentence.

**`docs/adr/0045-mail-outbox.md` (key formula).** The ADR says the idempotency key is the entry id plus a hash of the composed message. `workOrderIdempotencyKey` also hashes the recipient:

```27:31:server/modules/mail/domain/idempotency-key.ts
    .update(to.trim().toLowerCase())
    .update('\0')
    .update(message.subject)
```

`IdempotentWorkOrder` says the address is not part of the key. This same diff edits the ADR and leaves that sentence unchanged.

## Judgement

**Duplicated Code.** The “newer work order, same Ride and Driver” `exists` query is copied in `loadOutboxAttempt` and `readWorkOrderCurrentFacts` (`work-order-attempt.ts`). `composeAttempt` repeats the field walk in `readAssignedWorkOrder` (`work-order.ts`). `toInstant` copies `toPickup` and changes only the error string. `assign-access.ts`, `cancel.ts`, `correct.ts`, and `ride-change.ts` each do `const queue = await mailOutboxQueue()` and pass `{ queue, context }`.

**Data clump.** `OutboxMessage` and `IdempotentWorkOrder` are the same `subject` / `text` / `html` triple.

**Mysterious Name.** `stageWorkOrder` uses `MAIL_RETRY_DELAYS_MS[0]` as the backup job delay. `retry.ts` says index 0 is the wait after the first failure, not the delay before any failure.

Imports stay on module `index.ts` files. The worker’s `core/infrastructure` import matches the flight-landing worker, and the import gate allows it. Logs stay on ids. Both locales ship. Glossary terms stay Ride, Driver, Vehicle, and work order.

### Spec

### (a) Missing or partial

The first attempt still sends when the current-ness read does not succeed. A thrown read is logged and the snapshot goes out with the entry left pending. A read that returns no row is treated as current (`facts === null`). Spec: "Before every attempt the system checks that the mail still matters; if not, nothing is sent and the entry is stale." and "An attempt on a mail that is no longer current sends nothing and sets `stale`." The log line itself matches "A failed current-ness read logs { event: 'mail_outbox.current_check_failed', entryId }."

The rest of the owner list is in the diff: the immediate attempt plus a +1 minute job, then waits of 1, 5, and 30 minutes and at most four sends; `sent` and `failed`; same-driver replacement with `newer.driver_id = o.driver_id` and shared `created_at`; cancel stales assigned and changed only; `no_longer_yours` retries use `mail_outbox.vehicle_id`; the idempotency header, the concurrent 409, and `AbortSignal.timeout(15000)`; the tenant job; the stale office outcome and the hr/en sentences. The original issue lines that a newer same-driver row does not stale the older one, and that pickup time stales, are the 18.10. rules this branch follows.

### (b) Scope creep

When a job runs before `next_attempt_at`, the handler enqueues a replacement job and returns without sending or counting. Issue #329 and ADR-0045 do not ask for that early-job put-back.

### (c) Implemented but wrong

An empty load is not the failure path. `loadOutboxAttempt` inner-joins the ride, the transfer, the driver, and the settings. No row becomes null, and the handler returns, so pg-boss completes the job. A pending outbox row whose join missed stays pending with no further job. Spec: "If the row cannot be loaded, log only { event: 'mail_outbox.attempt_failed', entryId } and rethrow for pg-boss." That log and rethrow run only when the load throws.

The idempotency hash case-folds the recipient (`trim().toLowerCase()`) while the Resend body posts the original `to`. A case-only change keeps the key and changes the payload. ADR-0045: "The same key with a different payload returns `409 invalid_idempotent_request`." Issue: "The same content gives the same key. Changed content gives a new key." Only "409 concurrent_idempotent_requests is a transient failure." This other 409 still counts as an attempt, and later tries reuse that key until `failed`.
