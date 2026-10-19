# 332 Mail outbox retention

Out of scope: a shared fake `JobQueue` for tests, and a shared helper for the tick-and-fan-out shape that `flight-landing-worker.ts` and `retention.ts` now both use.

## Decisions

- Migration 0048 grants `DELETE` on `app.mail_outbox` to `transferpro_app` only, as ADR-0045 allows. It deletes no rows. It also adds `app.tenants_with_mail_outbox_before(timestamptz)`: security definer, returns Tenant ids only, pinned `search_path`, `REVOKE ALL FROM PUBLIC`, `EXECUTE` to `transferpro_app` only. That is the `tenants_due_flight_landing` pattern (0027).
- 0048 follows #335's `0047_client_version`, merged into `develop` as `fa11c71`. `_journal.json` lists 0047, then 0048 (`when` 1791400038000). `meta/0048_snapshot.json` carries 0047's body with its own id, so its `prevId` is 0047's id. `drizzle-kit check` passes.
- The daily tick (`15 3 * * *` UTC, queue `mail-outbox-retention`) publishes one job (`mail-outbox-retention-tenant`) per Tenant that holds an entry older than the cutoff. A Tenant with nothing to delete gets no job and no log line. Damir accepted this on 19.10.
- Each job runs on the Tenant's session from the job envelope and deletes `created_at < cutoff` in every state. The cutoff is 90 whole 24-hour days before the earlier of the payload's `askedAt` and the worker clock, so an entry exactly 90 days old stays and a payload from the future cannot reach a newer entry.
- One log line per job: `{ event: 'mail_outbox.retention_deleted', deleted }`. `tenant_id` comes from the session's log scope.
- The retention starts from the existing `server/plugins/mail-outbox.ts`, on the shared mail queue. The mail module exports only `startMailOutboxRetention`. `closeMailOutboxQueue` also ends the retention's listing pool, through `closeWithMailOutboxQueue` in `queue.ts`, which keeps `retention.ts` from being imported by the queue file.
- Flagged test change: `outbox.rls.test.ts`, "hides Tenant A entries from Tenant B, and Tenant B cannot change or delete them". It asserted that the app role's delete on `app.mail_outbox` is refused (42501). The grant makes that false, so the assertion is removed. The test now asserts Tenant B's unfiltered delete removes none of Tenant A's entries.
- Results after merging `origin/develop` (`fa11c71`):
  - `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (711) passed.
  - `pnpm test:rls` passed in full (44 files, 338 tests) on `transferpro_e2e`, recreated and migrated through 0048 with the e2e URL rewrite. The dev database `transferpro` was not migrated or reset, so 0048 is not applied there.
  - `pnpm test:e2e` passed in full: 287 tests in 3.8m, on database `transferpro_e2e` only.
  - `pnpm audit --audit-level=high` exited 0.

## Code review

Fixed point `origin/develop` (`81cfbba`). Reviewed commits `203fb85` and `05412a1`. Both subagents ran on the full model, not a fast one. After the review, `86ac5ce` trimmed the two comments named under Standards, made the RLS test call the worker's own Tenant listing, and added the `auth` grant check named under Spec. The owner accepted the fan-out to Tenants with old entries on 19.10.

### Standards

## Standards

The diff mostly follows the repo's standards. There is one item to flag about a removed test assertion, plus a few judgement calls.

**Hard (documented standard)**

- **`server/modules/mail/infrastructure/outbox.rls.test.ts`**: a test assertion was removed. This is `expect(withAppTenant(world.tenantId, client => client.query('delete from app.mail_outbox'))).rejects.toMatchObject({ code: '42501' })`, which proved the app role cannot delete its own Tenant's rows.
  - The removal is justified: the new grant makes that assertion false, and the cross-Tenant delete check was strengthened in the same test.
  - However, AGENTS.md says "Never weaken or remove a test; flag any that you did". The `/implement` report and the PR body must name this removal. It is a breach only if it isn't flagged.

**Judgement calls (repo comment rule: comments state constraints only, no history or reviewer narration)**

- **`db/mail-outbox.ts`**: "No other app table gained a DELETE grant with it." is change history aimed at the reviewer. The constraint that should remain is "Only this table has a DELETE grant (ADR-0045)."
- **`0048_mail_outbox_retention.sql`**: "This migration deletes no rows." describes the change, not the schema. It reads as reassurance for the reviewer.

**Baseline smells (all judgement calls)**

- **Duplicated Code, production code**: `registerMailOutboxRetention` repeats `registerFlightLanding` step for step:
  - the same `askedAtSchema` (`z.object({ askedAt: z.iso.datetime() })`);
  - `schedule(TICK, cron, {})`, then `workScheduled` with `for (tenantId of await listTenantIds(...)) await publish(tenantId, X, { askedAt })`;
  - `start()` building a `pg.Pool` and running `z.array(z.object({ tenant_id: z.uuid() })).parse(listed.rows).map(...)`.

  This is the second copy. A third scheduled job would justify a shared helper in `core`; for now it can stay.
- **Duplicated Code, tests**:
  - A hand-written fake `JobQueue` now exists in `retention.test.ts` and `retention.rls.test.ts`, and already in `flight-landing-worker.test.ts`, `attempt.test.ts` and `outbox.rls.test.ts`. A shared fake in `core/testing` would remove these copies.
  - `retention.rls.test.ts` writes its own `begin` / `set_config('app.tenant_id', …)` / `commit` instead of a `withAppTenant` helper like the one in `outbox.rls.test.ts`.
  - Its `listTenantIds` repeats the production query but drops the Zod parse. Calling the code inside `startMailOutboxRetention` would test the real listing path.
- **Speculative Generality (minor)**: `MAIL_RETENTION_DAYS` is exported only so the test can check it equals 90. It is harmless.

**Checked and conforming**

- **DELETE grant**: limited to `app.mail_outbox` and `transferpro_app`, as ADR-0045 allows. A test pins the full list of DELETE grants.
- **Listing function**: `app.tenants_with_mail_outbox_before` copies the 0027 pattern. It is SECURITY DEFINER, sets `search_path`, returns Tenant ids only, revokes from PUBLIC and grants EXECUTE to the app role only.
- **Tenant id**: comes from the job envelope and the session, never from the payload. A future `askedAt` is clamped to the clock.
- **Zod**: used at both runtime boundaries, the job payload and the rows the listing function returns.
- **Log line**: `{ event, deleted }` only. The `tenant_id` comes from async context, as ADR-0012 requires.
- **Module boundaries**: the plugin imports only from `modules/mail` `index.ts`. `domain/retention.ts` is pure and imports nothing from Drizzle, Nuxt or the queue.
- **Isolation tests**: they prove Tenant A cannot delete Tenant B's rows, and that no other table changes.

### Spec

## Spec

Most of issue #332 is implemented as written. Two decisions depart from the issue's wording and need an owner sign-off. Nothing in the diff looks functionally wrong.

**(a) Missing or partial**

- *"fans out one job per Tenant"* and *"One log line per Tenant with the count only."* The tick calls `app.tenants_with_mail_outbox_before(cutoff)`, so it only publishes jobs for Tenants that have an entry older than the cutoff. A Tenant with nothing to delete gets no job and no log line (0 is never logged). This saves work and copies the `tenants_due_flight_landing` pattern from migration 0027. Still, it narrows the requirement, and the owner should approve it or ask for every Tenant.
- *"Owner migration check in the PR: the grant names this table only, and the migration deletes no rows itself."* This can't be checked yet because no PR exists. The migration does delete no rows, and its only grant is `DELETE ON app.mail_outbox TO transferpro_app`. That check should also mention the new function described below.

**(b) Not asked for (scope creep)**

- *"Migration: `DELETE` on the outbox table only…"* The migration also adds a new security definer function, plus `GRANT EXECUTE` to `transferpro_app`. It lets the app role read which Tenants have old entries, across all Tenants. It returns ids only and has an existing precedent, but it is a second grant and a new cross-Tenant surface the issue didn't list.
- The per-Tenant job uses the earlier of the payload's `askedAt` and the worker clock as its cutoff. Nobody asked for this. It is harmless: it can only keep more entries, never delete newer ones, and it has its own unit test.

**(c) Implemented, but needs a look**

- *"Never weaken or remove a test; flag any change"* (AGENTS.md). In `outbox.rls.test.ts`, the assertion that the app role's `delete from app.mail_outbox` is refused with `42501` was removed. The grant makes that assertion false, so the change is legitimate. It was replaced with "Tenant B's unfiltered delete removes 0 of Tenant A's rows". It must be flagged in the report and the PR. Neither commit message nor any handoff note flags it yet.
- *"No other table gains a `DELETE` grant."* The new grant test lists DELETE grants only in the `app`, `audit` and `platform` schemas and skips `auth`. It expects the existing `app.roster` and `app.tenant_settings` grants and asserts the full list, so a new grant in those schemas would fail it. A new DELETE grant in `auth` would go unnoticed.
- *"A test proves no other table lost rows."* The test compares row counts before and after across `app`, `audit`, `auth` and `platform`, read by the owner role. This meets the criterion. On a shared test database, other tests running at the same time could make it flaky.

**Matches the spec**

- Migration number `0048`, journal `when` 1791400038000 (above 1791400037000). The migration deletes no rows.
- The job runs daily (`15 3 * * *`) through `schedule` and `workScheduled`. Each per-Tenant job runs in that Tenant's session from the job envelope.
- Entries are deleted in every state, using `created_at < cutoff`, so an entry exactly 90 days old stays.
- With a fixed clock, the 89-day and 90-day entries stay and all four 91-day states go. Tenant B's entries survive Tenant A's job. A Tenant A session cannot delete Tenant B's rows.
- The log line holds the count; in production the job adds the Tenant id.
