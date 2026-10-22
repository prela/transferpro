# 444 Node and pnpm security patch

Out of scope: dependency upgrades, raising the Node `engines` floor, and changing the capacity refusal dialog.

## Decisions

- Node 24.22.1 is the pin in the Dockerfile (both stages), `.nvmrc`, `package.json` `devEngines.runtime`, and every `node-version` in `.github/workflows/ci.yml` and `agent-guard.yml`. `engines.node` stays `^22.19.0 || ^24.11.0 || >=26.0.0`.
- pnpm is `12.15.0` in `packageManager`, `engines.pnpm` (`>=12.15.0 <13`), and the CI `pnpm/action-setup` version. The lockfile moves only that package manager and the Node runtime `24.21.0` → `24.22.1`. No dependency upgrade.
- pnpm 12.15.0 and its `@pnpm/exe.*` packages are younger than the release-age gate, so `pnpm-workspace.yaml` lists them on `minimumReleaseAgeExclude`. Drop those lines once that version installs without an exclude.
- `capacityDialogReason` is `capacityRefusalReason`. The mappings stay `fully_booked` → `fullyBooked`, `ride_overlap` → `overlap`, `ride_unavailable` → `unavailable`, and anything else → `null`. The copied refusal catch in the five call sites stays; this ticket is a rename only.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (933) passed. `pnpm test:e2e` passed (331). `pnpm audit --audit-level=high` exited 0 (2 high findings already ignored in `pnpm-workspace.yaml`). No migration.

## Code review

## Standards

**Hard violations:** none.

The pin is the same value in `.nvmrc`, `Dockerfile`, `package.json` `devEngines`, both workflows, and `pnpm-lock.yaml`. `engines.node` stays the existing range (`^22.19.0 || ^24.11.0 || >=26.0.0`); only the pnpm floor moves to `>=12.15.0 <13`. `minimumReleaseAgeExclude` lists each `@pnpm/exe.*@12.15.0` already in the lockfile, with why and when to drop, matching the comment already on that list. `docs/agents/working-rules.md` (Audit ignores) requires that comment shape for `ignoreGhsas` only, so this is consistent with the file, not a breach of that rule.

`capacityDialogReason` → `capacityRefusalReason` is a rename of the helper that already returns `CapacityRefusalReason`. Call sites import it from `shared/index.ts`. No new deep import (`AGENTS.md` module boundaries; ADR-0018). Assertions in `shared/unavailability.test.ts` are unchanged, so the test is not weakened (`AGENTS.md`). Glossary terms are untouched. Commit type is Conventional Commits; the body states the rename.

**Judgement call — Duplicated Code.** The same catch is copied in `RideAssign.vue`, `RideHandOff.vue`, `RideReassign.vue`, `RideVehicle.vue`, and `app/composables/transfer-form.ts`:

```
const reason = capacityRefusalReason(errorCode(error))
if (reason) {
  refusalReason.value = reason
  refusalOpen.value = true
```

The diff only renames the callee. The copy is why that rename is repeated. No documented rule requires one shared handler.

## Spec

**(a) Missing or partial**
None. Dockerfile build and runtime are `node:24.22.1-bookworm-slim`. `packageManager` is `pnpm@12.15.0` and `engines.pnpm` is `>=12.15.0 <13`. Every `node-version` in `ci.yml` and `agent-guard.yml` is `24.22.1`. The lockfile moves only pnpm `12.10.1` → `12.15.0` and the Node runtime `24.21.0` → `24.22.1`. `capacityDialogReason` is `capacityRefusalReason` at the definition, the shared export, the five call sites, and the test. “Done when” (local suite, CI, staging `/api/ready`) is acceptance outside this diff.

**(b) Scope creep**
None. `.nvmrc`, `devEngines.runtime`, the CI pnpm `version: 12.15.0` pins, and the `minimumReleaseAgeExclude` lines for `pnpm@12.15.0` and its `@pnpm/exe.*` packages are the install surface of those two pins. The rename keeps the same body and the same mappings (`fully_booked` → `fullyBooked`, `ride_overlap` → `overlap`, `ride_unavailable` → `unavailable`, anything else → `null`).

**(c) Implemented but wrong**
None against “both stages node:24.21.0-bookworm-slim → node:24.22.1-bookworm-slim”, “packageManager pnpm@12.10.1 → pnpm@12.15.0; raise engines.pnpm floor to match”, “CI workflows: any pinned Node version to 24.22.1”, “Lockfile regenerated only if pnpm requires it; no dependency upgrades”, or “rename capacityDialogReason to capacityRefusalReason … Rename only, no behaviour change.”
