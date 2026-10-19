# 330 Failed mail

Out of scope: invitations in the failed-mail block, the 90-day delete, and repairing the local `mail_outbox_shape` check.

## Decisions

- The one office home read lists failed work orders that are still current under ADR-0045. Nothing is written on read. Pickup time does not stale a work order. `no_longer_yours` goes stale only when the Ride is `done` or `no-show`, or when the same Driver gets a newer work order.
- "Pošalji ponovno" is one immediate attempt. Success becomes `sent`. A mail that no longer matters is not sent and becomes `stale`. A rejection stays `failed`. The attempt count stays, and no new retry cycle starts. No audit entry. One log line names the entry id, the kind, and the outcome.
- A 404 on resend means another member already settled the row. Home refreshes and shows no "Mail nije poslan."
- The stale sentence stays on screen after the last row leaves. The Croatian copy ends with a period.
- Migration 0046 adds `mail_outbox_failed_tenant_idx` on `tenant_id` where `state = 'failed'`. Journal `when` is 1791400036000. `pnpm db:migrate:local` applied that index to the local dev database. No reset and no hand-written SQL.
- The Home e2e plants a `failed` row instead of waiting about 36 minutes for the three automatic attempts.
- `origin/develop` was already contained in this branch. QC called the `pnpm test:rls` failure local drift of an older 0045 check, not a bug on this branch.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (681). `pnpm test:e2e` passed: 274 (4.4m), database `transferpro_e2e` only. No other Playwright test was running. `pnpm audit --audit-level=high` exited 0.

## Code review

Fixed point `origin/develop` (`7c8db55`). Reviewed commit `1f76ac2`, then `fd9368e` kept the stale sentence. Both subagents started with `fast=false`. The reports below are that review.

### Standards

## Standards

**Hard violations:** none. The slice matches the rules that apply here: the failed-mail list is filled inside `loadOfficeHome` (one office read, ADR-0024 / ADR-0045), it stays outside both attention tiers (ADR-0039), the resend route’s helper enforces admin/dispatcher itself (`officeOnly` in `resendFailedMail`, AGENTS.md), the journal `when` is the previous entry plus 1000, both locales ship, instants use `formatInstant`, and the resend log is entry id, kind, and outcome with no audit entry (ADR-0045). Mail is reached through `server/modules/mail/index.ts`. The repeated `officeOnly` is the allow-list rule, not a smell to extract.

**Judgement calls**

- **Duplicated Code** — `failedWorkOrderMatters` repeats the finished/cancelled mapping already in `factsFrom` (`server/modules/transfers/infrastructure/work-order-attempt.ts`). New copy:

```36:53:server/modules/mail/domain/current.ts
const FINISHED_RIDE_STATES = new Set(['done', 'no-show'])
// ...
rideFinished: FINISHED_RIDE_STATES.has(row.rideState),
rideCancelled: row.rideState === 'cancelled',
```

The same `exists (… newer.created_at > o.created_at …)` superseded predicate is copied into `failedWorkOrdersQuery` from the two queries in `work-order-attempt.ts`.

- **Duplicated Code** — `plantFailedWorkOrder` repeats the owner-pool transaction already in `withOwnerTransaction` in the same file (`begin`, `set_config('app.tenant_id'…)`, commit/rollback, `pool.end()`).

- **Divergent Change** — `server/modules/transfers/infrastructure/failed-mail.ts` is both the Home list query and the resend session (role, mailer, log, 404). A list-shape change and a send-action change edit the same module.

- **Speculative Generality** — `plantFailedWorkOrder` takes `status` and `vehicleId`; the only caller passes `{ rideId, driverId }`.

### Spec

## Spec

### (a) Missing or partial
- "E2e extends the Home spec: a failing fake send appears in the block after the attempts and Pošalji ponovno clears it." The Home spec plants a `failed` row (`plantFailedWorkOrder`) and only checks resend. It never shows a failing fake send landing in the block after the attempts.

### (b) Scope creep
None that changes the ticket. The row also shows pickup, place names, and work-order status. The quoted lines only require the Driver’s name, the count, and Pošalji ponovno.

### (c) Implemented but wrong
- "A mail that is no longer current sends nothing, becomes stale, and the office sees Mail više nije aktualan." The route returns `stale` and the copy exists, but the alert sits inside `v-if="mails.length > 0"`. A stale resend drops the row on the next Home read, so a block that becomes empty unmounts the alert and the office never sees that sentence.

The read filter matches ADR-0045 (`done` / `no-show`, cancel except `no_longer_yours` and the cancellation notice, newer work order for the same Ride and Driver). Pickup is not a stale rule. The partial index, role checks, cross-tenant 404, no audit, and the one resend log line are present.
