# 525 Nuxt, pnpm, and Better Auth patches

Out of scope: Better Auth 1.8, h3 2, a blanket `pnpm update`, and running RLS against the local `transferpro` database.

## Decisions

- Nuxt is `^4.6.3`. The lockfile has one `nuxt@4.6.3` importer. `@nuxt/kit@4.6.2` remains only as a transitive of `vite-plugin-inspect` / `@dxup/nuxt`. `nitropack` stays `2.13.5`. h3 stays `1.15.11`.
- pnpm is `12.16.0` in `packageManager`, `engines.pnpm` (`>=12.16.0 <13`), and every CI `pnpm/action-setup` pin.
- Better Auth and `@better-auth/drizzle-adapter` are `^1.7.14`. Direct transitives move with that line (`@better-auth/*` 1.7.14, `@better-auth/utils` 0.5.1, `@better-fetch/fetch` 1.3.3). 1.7.13/1.7.14 notes are TOTP import, Kakao `loginHint`, type-export cleanup, and unused social-provider options. This app has no `socialProviders` and no 2FA import path. No Drizzle migration.
- **Deviation — `seroval@1.7.2`.** The lockfile previously trusted `seroval@1.6.11` (same maintainer, no provenance). `@nuxt/vite-builder` 4.6.3 requires `seroval@^1.7.2`. 1.7.0 and 1.7.1 were trusted-publisher + provenance; 1.7.2 is the same maintainer as 1.6.11 without that evidence, so `trustPolicy: no-downgrade` refuses it. `trustPolicy` stays `no-downgrade`. `trustPolicyExclude` adds only `seroval@1.7.2`. Drop that line once Nuxt depends on a trusted seroval.
- Age-gate excludes roll to Better Auth 1.7.14, pnpm 12.16.0, and Nuxt 4.6.3. Drop each line once that version installs without an exclude.
- Conclude checks: `pnpm exec nuxi build` passed. `pnpm lint` passed. `pnpm typecheck` passed. `pnpm test` passed (1048). `pnpm test:e2e` passed (377) on `transferpro_e2e`, including sign-in, session lifetime, and signed-out cookie routes. `pnpm audit --audit-level=high` exited 0. `pnpm test:rls` did not run: the local `DATABASE_URL` does not name `transferpro_e2e`, and the script exits before vitest. This slice adds no migration and no tenant table.

## Code review

## Standards

No hard documented-standard breaches in the four-file bump. `pnpm-lock.yaml` skipped (generated).

**`pnpm-workspace.yaml`** — age/trust comments match the file’s own rule and `docs/agents/working-rules.md` (“Audit ignores”: only comment a GHSA ignore when it is dev/build-only; this diff does **not** add `ignoreGhsas` ids). Better Auth / pnpm / Nuxt `minimumReleaseAgeExclude` lines carry drop-when comments; `seroval@1.7.2` has a trust-downgrade reason and drop condition. `CHARTER.md` stack (Nuxt 4, Better Auth, pnpm) is unchanged. ADR-0018 / `GLOSSARY.md` do not apply (no module or domain terms).

**`package.json` / `.github/workflows/ci.yml`** — `packageManager` and `engines.pnpm` move together with the five `pnpm/action-setup` pins. No domain, RLS, audit, or deep-import code.

### Judgement (baseline smells)

**Duplicated Code / Shotgun Surgery** — same pin copied five times:

```yaml
- uses: pnpm/action-setup@v6
  with:
    version: 12.16.0
```

Repo already used per-job copies; this only retouches them. A single version source would shrink the scatter; not required by a written rule.

No Mysterious Name, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Divergent Change (workspace file is the policy home), Speculative Generality (unused Better Auth adapter excludes were already the install-gate list), Message Chains, Middle Man, or Refused Bequest.

## Spec

**(a) Missing or partial**

The review ran before conclude. The two gaps it named are closed or recorded in Decisions:

- **“Lockfile updated; build, lint, typecheck, unit, RLS and e2e green.”** Pins and lockfile match the three requested lines. After conclude: build passed; lint passed; typecheck passed; unit 1048 passed; e2e 377 passed on `transferpro_e2e`. RLS still does not start locally because `DATABASE_URL` does not name `transferpro_e2e`; that is out of scope here, not a missing pin.
- **“No behaviour change; login and session cookies verified.”** After conclude, the e2e run includes sign-in, session lifetime, and signed-out cookie routes. No app behaviour was added in the bump itself.

**(b) Scope creep**

- First-party `package.json` deps otherwise unchanged. `minimumReleaseAgeExclude` rolled to Better Auth 1.7.14, pnpm 12.16.0, and Nuxt 4.6.3 packages — needed to install those versions, not extra upgrades.
- `engines.pnpm` floor `>=12.16.0 <13` is tighter than “`packageManager` … and any CI pin” but keeps the existing pin pair; not an unrelated package bump.
- **Follow-up:** `trustPolicy` stays `no-downgrade`; `semver` exclude unchanged; **`trustPolicyExclude` adds only `seroval@1.7.2`**, with a comment that `@nuxt/vite-builder` 4.6.3 needs `^1.7.2` and that 1.7.2 lacks the trusted-publisher/provenance of 1.7.0/1.7.1. That is the asked-for narrow allowance, not a global trust weaken.

**(c) Implemented but looks wrong**

- None on the requested versions: lockfile importers resolve `nuxt` 4.6.3, Better Auth 1.7.14, pnpm 12.16.0; no leftover `seroval@1.6.11` or Better Auth 1.7.12.
- `@nuxt/kit@4.6.2` still appears as a **transitive** of `vite-plugin-inspect` / `@dxup/nuxt`, not the app `nuxt` pin. Not a failed 4.6.3 bump.

No issue comments / Owner decisions to apply.
