# 422 Null changed-by member on notes and contacts

Out of scope: Transfers and Clients already require a present member (#345).

## Decisions

- Migration `0057_notes_contacts_changed_by_present` replaces `client_notes_data_change` and `client_contact_persons_data_change`. `0050` and `0054` stay as applied.
- On `develop` the latest migration was `0056_handed_off_partner`. The journal `when` is that entry plus 1000.
- The migration scans `app.client_notes` and `app.client_contact_persons` first and raises if a row would fail the new check. It does not update rows.
- Version 0 stays no time and no member. Version 1 or higher still requires a time, and the member must be present and not empty. `<> ''` alone is unknown when the member is null.
- The Drizzle declarations match the new checks, so a later generate does not put the hole back.
- The same predicate stays on each table. A Client note and a contact person each keep the Client version (ADR-0046, ADR-0049).
- `pnpm test:rls` on `transferpro_e2e` passed (419) after this branch recreated that database and migrated through `0057`. The dev database `transferpro` was not migrated.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (884) passed. `pnpm test:e2e` passed (320, 4.7m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Fixed point `origin/develop` is `87cf7d494dd7efdfbdb7917fe24d4075748d6e91`. Reviewed `git diff origin/develop` plus untracked `db/migrations/0057_notes_contacts_changed_by_present.sql` and `db/migrations/meta/0057_snapshot.json`.

## Standards

No hard breaches of `AGENTS.md`, `docs/agents/working-rules.md`, `GLOSSARY.md`, ADR-0011, ADR-0046, or ADR-0049.

**Compliant.** `0057` tightens `client_notes_data_change` and `client_contact_persons_data_change` the same way `0055` did for clients and transfers: version 0 stays null author and time; version ≥ 1 requires a present, non-empty `data_changed_by`. ADR-0049 gives each Contact person and Client note its own ADR-0046 version. The `DO` block does not rewrite rows; the owner scan is the ADR-0011 bypass, and the comment says so. Journal `when` is `1791400046000 + 1000` (`docs/agents/working-rules.md`, Database roles and migrations). Snapshot `prevId` is `0056`, both checks match the SQL, and `isRLSEnabled` stays true. No new table, grant, or policy. RLS tests assert `23514` and the constraint name on insert and update, which is catalog behaviour (`working-rules.md`, RLS and the tenant session). “Member” in those tests is the author id, not the Contact person (`GLOSSARY.md` still avoids calling a Contact person a Member).

**Judgement — Duplicated Code.** The same comment and predicate are copied in `db/client-notes.ts` and `db/client-contact-persons.ts`:

```sql
(${table.version} >= 1 and ${table.dataChangedAt} is not null and ${table.dataChangedBy} is not null and ${table.dataChangedBy} <> '')
```

The two new RLS tests are the same insert-then-update shape. The migration repeats that predicate four times. `db/clients.ts` and `0055` already inline this per table, so a shared helper would be new, not required.

## Spec

Compared `git diff origin/develop` and untracked `0057_notes_contacts_changed_by_present.sql` and `0057_snapshot.json` with issue #422 and the #345 pattern in `0055_version_changed_by_present.sql`.

### (a) Missing or partial

None. Migration 0057 scans `app.client_notes` and `app.client_contact_persons`, raises if a row would fail the new predicate, and does not `UPDATE`. It drops and re-adds both `*_data_change` checks. Version 0 stays `version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL`. Version ≥ 1 requires `data_changed_at IS NOT NULL AND data_changed_by IS NOT NULL AND data_changed_by <> ''`. The Drizzle schemas and snapshot (`prevId` is 0056) carry the same predicates. RLS tests insert and update both tables with `version = 1`, `data_changed_at = now()`, `data_changed_by = null`, and expect `23514` plus the constraint name.

### (b) Scope creep

None. The journal entry, snapshot id/prevId, and the two check values are the same migration bookkeeping #345 used. Against 0056, the snapshot differs only in id, prevId, and those two checks. Schema comments do not change behaviour.

### (c) Implemented but wrong

None. The scan predicate matches the new `CHECK`. Constraint names are unchanged. Test rows use a valid note and a phone already accepted in the same file, so the expected failure is the data-change check.
