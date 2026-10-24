# 492 Charter destructive-database exception

Out of scope: editing `AGENTS.md`, the e2e harness, and any application code or test.

## Decisions

- Issue #492 is the approval to edit `CHARTER.md`. The Constraints bullet now names the same exception as `AGENTS.md` Security: `pnpm test:e2e` may drop and recreate `transferpro_e2e` on localhost or the CI service host `postgres`.
- The follow-up replaces “Every other database stays forbidden.” with “Destructive operations on any other database stay forbidden.” and changes “mass delete” to “mass delete/update”. The existing singular “destructive migration” stays.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (995) passed. `pnpm test:e2e` passed (349). No migration.

## Code review

## Standards

No hard violations. No baseline smells.

`CHARTER.md` (constraints bullet, one hunk). Issue #492 and the owner’s follow-up are treated as approval, so `AGENTS.md` Read first item 1 and the charter line “Do not edit this Charter without owner approval” are not breached by the edit itself.

The new sentence matches the documented exception:

- `AGENTS.md` Security: no destructive DB operations (`drop`, `truncate`, `mass delete/update`, destructive migrations), except `pnpm test:e2e` dropping and recreating only `transferpro_e2e` on localhost or the CI host `postgres`.
- `docs/agents/working-rules.md` e2e harness bullet: `e2e/prepare-database.ts` drops and recreates that database on those same hosts and does not use the dev database. `AGENTS.md` wins if working rules disagree; they do not here.
- “Destructive operations on any other database stay forbidden.” and “mass delete/update” are the owner’s required wording.

Commit subjects are Conventional Commits and do not name a model. No glossary term is used. The change is one bullet in one file, so none of the baseline smells apply.

## Spec

No missing, partial, extra, or incorrect requirements.

**(a)** Nothing missing. The Constraints bullet now states the requested exception: the e2e harness (`pnpm test:e2e`) dropping and recreating `transferpro_e2e`, on localhost or the CI service host `postgres`. The owner follow-up is present as specified: "Destructive operations on any other database stay forbidden." and "mass delete/update". The diff is docs only (`CHARTER.md`). Against the AGENTS.md Security paragraph, the actor (`pnpm test:e2e`), the action (drop and recreate), the database name (`transferpro_e2e`), and the hosts (localhost or the CI service host `postgres`) are the same.

**(b)** No scope creep. Both commits change only that Constraints bullet. The second commit is the owner wording follow-up, which is in scope. "Docs only, one commit, no code or test change." — the second docs commit is the allowed follow-up, and there is no code or test change.

**(c)** Nothing implemented incorrectly. The added sentence matches "the only allowed destructive database operation is the e2e harness dropping and recreating transferpro_e2e, on localhost or the CI service host postgres." The follow-up replacements match "Destructive operations on any other database stay forbidden." and "Align 'mass delete' to 'mass delete/update' as in AGENTS.md."
