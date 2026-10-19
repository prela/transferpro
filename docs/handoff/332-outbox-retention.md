# 332 Mail outbox retention

Out of scope: a shared fake `JobQueue` for tests, and a shared helper for the tick-and-fan-out shape that `flight-landing-worker.ts` and `retention.ts` now both use.

## Merge order

- #335 (`feature/335-client-stale-save`, PR #346) must merge first. It takes `0047_client_version` (`when` 1791400037000). This branch takes `0048_mail_outbox_retention` (`when` 1791400038000) and has no idx 47 of its own.
- After #335 merges, merge `origin/develop` into this branch:
  - `_journal.json`: keep the 0047 entry, then the 0048 entry.
  - `meta/0048_snapshot.json`: its `prevId` is 0046's id today. Replace its body with 0047's snapshot and keep 0048's own `id`, so `prevId` becomes 0047's id (`c44fca00-…`). Otherwise the next `drizzle-kit generate` stops on two snapshots with one parent.
  - Run `pnpm test:rls` on a freshly migrated database.

## Decisions

- Migration 0048 grants `DELETE` on `app.mail_outbox` to `transferpro_app` only, as ADR-0045 allows. It deletes no rows. It also adds `app.tenants_with_mail_outbox_before(timestamptz)`: security definer, returns Tenant ids only, `REVOKE ALL FROM PUBLIC`, `EXECUTE` to `transferpro_app` only. That is the `tenants_due_flight_landing` pattern (0027).
- The daily tick (`15 3 * * *` UTC, queue `mail-outbox-retention`) publishes one job (`mail-outbox-retention-tenant`) per Tenant that holds an entry older than the cutoff. A Tenant with nothing to delete gets no job and no log line. Owner question: is "one job per Tenant" meant as every Tenant? Listing every Tenant needs another security definer function.
- Each job runs on the Tenant's session from the job envelope and deletes `created_at < cutoff` in every state. The cutoff is 90 whole 24-hour days before the earlier of the payload's `askedAt` and the worker clock, so an entry exactly 90 days old stays and a payload from the future cannot reach a newer entry.
- One log line per job: `{ event: 'mail_outbox.retention_deleted', deleted }`. `tenant_id` comes from the session's log scope.
- The retention starts from the existing `server/plugins/mail-outbox.ts`, on the shared mail queue. The mail module exports only `startMailOutboxRetention`.
- Flagged test change: `outbox.rls.test.ts`, "hides Tenant A entries from Tenant B, and Tenant B cannot change or delete them". It asserted that the app role's delete on `app.mail_outbox` is refused (42501). The grant makes that false, so the assertion is removed. The test now asserts Tenant B's unfiltered delete removes none of Tenant A's entries.

## Results

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` (705) passed.
- `pnpm test:rls` ran on `transferpro_e2e`, recreated and migrated through 0048 by `e2e/prepare-database.ts` with the e2e URL rewrite. All 44 files and 332 tests passed, including the local-drift test. The dev database `transferpro` was not migrated or reset, so 0048 is not applied there.
- `pnpm test:e2e` was not run: no UI change.

## Code review

Fixed point `origin/develop` (`81cfbba`). Both subagents ran on the full model, not a fast one.

- Standards: fixed the two comments that described the change rather than a constraint, and the RLS test now calls the worker's own Tenant listing. Left as judgement calls: the tick-and-fan-out shape repeated from the flight-landing worker, the hand-written fake queues in tests, and `MAIL_RETENTION_DAYS` exported for its test.
- Spec: fixed the grant check so it also refuses a `DELETE` grant in schema `auth` for any role but the auth role. Open for the owner: the fan-out lists only Tenants with old entries, and the migration adds the listing function beside the grant.
