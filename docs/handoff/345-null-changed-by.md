# 345 Null changed-by member

Out of scope: client notes and contact persons keep the old check. NEO will file a follow-up.

## Decisions

- Migration `0055_version_changed_by_present` replaces `transfers_data_change` and `clients_data_change`. `0043` and `0047` stay as applied.
- On `develop` the latest migration was `0054_client_notes`. The journal `when` is that entry plus 1000.
- The migration scans `app.transfers` and `app.clients` first and raises if a row would fail the new check. It does not update rows.
- Version 0 stays no time and no member. Version 1 or higher still requires a time, and the member must be present and not empty. `<> ''` alone is unknown when the member is null.
- The Drizzle declarations match the new checks, so a later generate does not put the hole back.
- The same predicate stays on each table. A Transfer version and a Client version are separate checks (ADR-0046).
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (868) passed. `pnpm test:e2e` passed (316, 4.7m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Fixed point `origin/develop` is `058be3bcdb2d767b66104280ec5511bcfa8c395a`. Reviewed `git diff origin/develop` except `docs/handoff/355-unavailability-windows.md`, plus untracked `db/migrations/0055_version_changed_by_present.sql` and `db/migrations/meta/0055_snapshot.json`.

## Standards

## Hard violations

No documented-standard breach.

Checked and clear: journal `when` is the previous entry plus 1000 (`docs/agents/working-rules.md`, Database roles and migrations). Snapshot `prevId` is 0054's id, and the only body edits are the two checks. No new table, so the tenant-table rules in `AGENTS.md` Security stay untouched. The preflight raises and leaves rows in place (`AGENTS.md`: no mass update). `DROP CONSTRAINT` then `ADD` matches existing check replacements and runs in the migrator's single transaction. ADR-0046 still allows version 0 with no author; version ≥ 1 now requires a present member, which is what "records the time and the member" already required. Test titles use Client and Transfer (`GLOSSARY.md`). No new cross-module import, so ADR-0018 stays out of play. The new tests only add cases; they use `set_config` and assert the refused write (`docs/agents/working-rules.md`, RLS: prove the catalog, assert behaviour).

## Judgement calls

**Duplicated Code.** The same predicate and comment are copied in `db/clients.ts` and `db/transfers.ts`:

> `or (${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} is not null and ${table.dataChangedBy} <> '')`

`0055_version_changed_by_present.sql` repeats that predicate four times (two scans, two `ADD CONSTRAINT`). Both RLS tests repeat the null-member insert and update. Separate constraints are required: ADR-0046 puts the version on the Transfer row and gives a Client its own. The shared comment and the test body are the part worth extracting.

The old shape, `dataChangedBy <> ''` with no `is not null`, is still the check in `db/client-notes.ts` and `db/client-contact-persons.ts` (outside this diff). The new comment states the three-valued-logic hole as general. ADR-0046 names the Transfer version and a Client version only, so those leftover checks are a judgement call.

**Shotgun Surgery** is suppressed. The journal entry and migration SQL are required by `docs/agents/working-rules.md`, and an RLS test is required by `AGENTS.md` when tenant data is touched.

## Spec

### (a) Missing or partial
None.

### (b) Scope creep
None.

### (c) Implemented but wrong
None.

The diff matches issue #345. `0055_version_changed_by_present.sql` is a new migration (0043 and 0047 are untouched). On `origin/develop` the latest journal entry is `0054_client_notes`, so `0055` is the next number. It drops and re-adds `clients_data_change` and `transfers_data_change`. For `version >= 1` the predicate is `data_changed_by IS NOT NULL AND data_changed_by <> ''`, and the `data_changed_at IS NOT NULL` clause stays. The version 0 arm is unchanged: `version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL`. A `DO` block scans `app.transfers` and `app.clients` first and `RAISE EXCEPTION`s on any row the new check would refuse. There is no `UPDATE`. `db/clients.ts`, `db/transfers.ts`, the journal, and `0055_snapshot.json` carry the same two checks. The snapshot differs from `0054` only in `id`, `prevId`, and those two constraint strings.

Both RLS tests reject an insert and an update with `version = 1`, `data_changed_at = now()`, and `data_changed_by = null` (`23514`, `clients_data_change` / `transfers_data_change`). The existing client version test is unchanged. The new check only refuses rows the old check already allowed when the member is null, so those tests still describe valid failures.
