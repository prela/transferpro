Out of scope: adding a password-reset flow, and changing cookie or session behaviour in application code.

## Decisions

- Stay on Better Auth `^1.7.9` (`better-auth` and `@better-auth/drizzle-adapter`). 1.7.8 and 1.7.9 are bug fixes. This app has no password-reset flow and does not use `lastLoginMethod`, so no application change was required.
- The `minimumReleaseAgeExclude` lines for those 1.7.9 packages stay until each version installs without an exclude. The comment in `pnpm-workspace.yaml` is the reminder.
- Login and logout are covered by `e2e/auth.spec.ts`. There is no password-reset e2e spec.

## Code review

## Standards

No hard violations. The diff only bumps `better-auth` and `@better-auth/drizzle-adapter` to `^1.7.9`, refreshes `pnpm-lock.yaml`, and adds a `minimumReleaseAgeExclude` list. No application code, tests, migrations, or product scope. `CHARTER.md` does not apply. Conventional commit form matches `AGENTS.md`.

**Judgement call** — `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`). The new entries have no comment:

```yaml
minimumReleaseAgeExclude:
  - '@better-auth/core@1.7.9'
  - '@better-auth/drizzle-adapter@1.7.9'
  # …kysely, memory, mongo, prisma, telemetry, better-auth@1.7.9
```

Every other exception in this file says why it exists and when to drop it (`trustPolicyExclude`, `overrides`, `allowBuilds`, `ignoreGhsas`). `docs/agents/working-rules.md` (Audit ignores) requires that comment shape for `ignoreGhsas` only (“say in the comment why and when to revisit”), so this is not a hard breach of that rule. A one-line note — fresh 1.7.9 pins, remove once they pass `minimumReleaseAge` — would match the file.

**Baseline smells:** none. Lockfile plus workspace excludes is the required shape of a pnpm bump, not Shotgun Surgery. Adapter packages the app does not import are transitive peers of `better-auth`, not Speculative Generality.

## Spec

Diff is `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` on `chore/237-bump-better-auth` (`ad97dfe`). No application code.

### (a) Missing or partial

- **"The CI `fast` and `slow` jobs are green."** Not met. The branch is not pushed, so those jobs have not run. Local lint, typecheck, unit, RLS, and `e2e/auth.spec.ts` do not substitute for this line.
- **"The PR is opened without merging."** Not met. No pull request exists.

These two lines are the only open acceptance items. Login and logout e2e exist and were run locally (7 passed). **"Run their e2e specs if they exist"** is met for password reset: there is no password-reset spec, and this app has no password-reset flow.

### (b) Scope creep

None. `minimumReleaseAgeExclude` for the 1.7.9 packages is what pnpm needs to install them under the existing release-age policy, so the lockfile can resolve 1.7.9. Transitive `@better-auth/utils@0.5.0` and `better-call@1.4.2` follow the new peer ranges of 1.7.9. Uncommitted `docs/ops/backup-restore.md` is not in this diff.

### (c) Implemented but wrong

None. **"Bump `better-auth` (and any matching `@better-auth/*` packages) to 1.7.9 … and update the lockfile."** Both direct ranges are `^1.7.9`; the lockfile resolves `better-auth` and `@better-auth/drizzle-adapter` (and the other `@better-auth/*` 1.7.x entries) to 1.7.9. No `1.7.7` pins remain. **"Read the 1.7.x changelog for breaking changes and adapt if needed."** 1.7.8 and 1.7.9 are bug fixes for packages this repo uses; no app adaptation was required, so an empty application diff is correct.

After this review: the release-age comment is in `pnpm-workspace.yaml` (`e9c1085`). The PR is opened after this file. CI `fast` and `slow` run on that PR and are not green until they finish.
