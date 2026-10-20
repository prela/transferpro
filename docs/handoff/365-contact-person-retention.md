# 365 Contact person retention

Out of scope: a shared JobQueue test double, and a shared registrar with the unavailability retention job.

## Decisions

- Migration `0053_contact_person_retention` grants `DELETE` on `app.client_contact_persons` to `transferpro_app` only, as ADR-0049 allows. It deletes no rows. The restrictive policy `client_contact_persons_retention_delete` allows a delete only when `removed_at < now() - interval '90 days'`. A live row has null `removed_at`, so the predicate fails and the delete removes nothing.
- The same migration adds `app.tenants_with_contact_persons_removed_before(timestamptz)`: `SECURITY DEFINER`, `STABLE`, `search_path = pg_catalog, pg_temp`, Tenant ids only, `REVOKE ALL FROM PUBLIC`, `EXECUTE` to `transferpro_app` only.
- Develop has `0052_transfer_external_ref` at `when` 1791400042000. This job is `0053`, `when` 1791400043000 (that value plus 1000). `drizzle-kit check` passes.
- The daily tick is `45 3 * * *` UTC, queue `contact-person-retention`. It publishes `contact-person-retention-tenant` with `{ askedAt }` for each Tenant the listing function returns. The job uses its own pg-boss queue, the unavailability shape. The cutoff is 90 whole 24-hour days before the earlier of `askedAt` and the worker clock, so a row removed exactly 90 days ago stays and a future payload cannot delete a newer row.
- One log line per job: `{ event: 'contact_person.retention_deleted', deleted }`. `tenant_id` comes from the session log scope.
- `server/plugins/contact-person-retention.ts` imports `startContactPersonRetention` from the clients module index.
- Flagged test change: `contact-person.rls.test.ts` no longer expects `42501` when the app role deletes a live contact person. The grant makes that false. The delete removes 0 rows and the row is still there. Rows removed 89 and 91 days ago, and another Tenant's rows, are covered in `retention.rls.test.ts`. The mail retention DELETE-grant pin adds `app.client_contact_persons`. No test was removed.
- Results:
  - Before this rebase, `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (836) passed, and `pnpm test:e2e` passed (295 tests, `transferpro_e2e` only).
  - After the rebase onto `origin/develop` (`47002a2`), `pnpm test:rls` on the dev database `transferpro` was 382 passed and 1 failed. The failure is `outbox.rls.test.ts`, "refuses an assigned work order that names a vehicle": the local `mail_outbox_shape` check is missing the vehicle clause from `0045`. That drift is older than this job.
  - The same suite on a fresh `transferpro_e2e` migrated through `0053` passed: 52 files, 383 tests.
  - `pnpm audit --audit-level=high` exited 1 on pre-existing highs in vite and launch-editor (GHSA-587h-7wmj-h5pm). This slice adds no dependency.

## Code review

Fixed point `0acd2c8`. Reviewed commit `a851529`, before the rebase moved the migration to `0053`. Both axes ran on the full model, not a fast one. No code change came out of the review. The SQL of the grant, the policy, and the listing function is the same in `0053`.

### Standards

## Standards

No hard violations. The change stays inside the rules that apply to this job.

The `DELETE` grant is the one ADR-0049 allows, on `app.client_contact_persons` only, with a restrictive policy beside the existing `tenant_isolation` policy (`USING` and `WITH CHECK`). The table already has forced row-level security. The migration revokes the listing function from `PUBLIC` and grants `EXECUTE` to `transferpro_app`. The journal `when` is the previous entry plus 1000 (`docs/agents/working-rules.md`). The purge runs on the queue's tenant session and does not take a tenant id from a request (ADR-0011). The log line is the count only (ADR-0012, AGENTS.md). The cutoff lives in the clients domain with no Drizzle or queue import. The plugin imports `startContactPersonRetention` from the clients `index.ts` (ADR-0018). Job data and the listing rows are parsed with Zod. Cross-tenant survival is asserted by remaining row ids, not by policy SQL.

**Judgement call — Duplicated Code.** `fakeQueue` in `server/modules/clients/infrastructure/retention.test.ts` and `capturingQueue` in `retention.rls.test.ts` stub the same `JobQueue` surface (`enqueue`, `handleNext`, `schedule`, `workScheduled`, `work`, `close`). One shared test double would do. The registrar itself matching the unavailability job is not this smell: ADR-0049 says to follow that job, and ADR-0018 keeps it inside clients.

### Spec

## Spec

No missing, partial, extra, or incorrect requirements against issue #365 and ADR-0049.

**(a) Missing or partial.** None. Migration `0051` grants `DELETE` on `app.client_contact_persons` only, to `transferpro_app`, with restrictive policy `removed_at < now() - interval '90 days'`, matching the unavailability-window policy. `tenants_with_contact_persons_removed_before` returns tenant ids only. The daily JobQueue tick (`45 3 * * *`) lists those tenants and deletes on each tenant session. The handler logs `{ event, deleted }` only. Unit tests cover the 90-day cutoff (including the exact boundary and a DST-stable 24-hour span) and daily scheduling. The RLS tests delete 91- and 120-day rows, keep live and 89-day rows, reject a live row, a 10-day row, and another tenant's old row with `rowCount` 0, and show one tenant's run leaves the other tenant and every other table unchanged.

**(b) Scope creep.** None. The boot plugin, per-tenant fan-out, future-payload clamp, and the mail-outbox grant-list update follow the retention jobs this issue cites. The snapshot differs from `0050` only by this policy. The old contact-person RLS assertion changed from `42501` to `rowCount` 0 because this issue replaces "no DELETE" with a limited grant. That test was not removed, and the new RLS file covers the cases it no longer states.

**(c) Implemented but wrong.** None. A live row has `removed_at` null, so both the policy and `removed_at < cutoff` leave it. Exactly 90 days stays (`<`, not `<=`), which matches "more than 90 days ago." The job cutoff is `min(payload, clock) - 90 days`, so a request or a future payload cannot delete a newer row. ADR-0049 is the grant cited in the migration.
