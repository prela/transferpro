# Handoff: issue #9 foundation

Status: #9 is complete, including slice 5 (protected-branch hook, high audit, Dependabot, ASVS pull-request template).

Ticket **#9** is finished on branch `feature/9-foundation` in `/home/prela/projects/transfers/transferpro`. The branch tracks `origin/feature/9-foundation`.

Last commit on the branch before the CI slice: `c5850b3d1def72287b06759311a6a35e1e464f22` (`c5850b3`).

## Read first

1. `CHARTER.md`
2. `AGENTS.md`
3. `docs/adr/0011-tenant-session.md` (accepted). Do not re-decide it.
4. GitHub issue #9 (`gh issue view 9`)

## Done

| Commit | Slice |
| --- | --- |
| `df41dde` | Nuxt 4 skeleton. `pnpm typecheck` is `nuxi typecheck`. Pre-commit runs lint-staged, then typecheck, then `pnpm test`. |
| `5db33fa` | `tenantTable()`, `app.tenant_settings`, forced RLS, cross-tenant test green. |
| `d4dddd0` | Better Auth organizations. Tenant = organization. `app.tenant_member`. |

Earlier on the branch: four DB roles and local Postgres (`dae0af1`), ADR-0011 (`967291e`).

## Decisions already locked

- One transaction per call. `app.tenant_id` is set for that transaction only. `app.current_tenant_id()` is NULL when unset, so inserts fail and selects match nothing.
- Four roles: `transferpro_owner` (migrations, `BYPASSRLS`), `transferpro_app`, `transferpro_auth`, `transferpro_queue`. App, auth, and queue must not bypass RLS. Migrator URL is not part of the app env.
- Tenant tables live in schema `app` and are declared only through `tenantTable()`. It adds `tenant_id`, enables RLS, and one policy for the app role. drizzle-kit cannot FORCE RLS; `db/migrations/0000_tenant_settings.sql` does.
- Better Auth tables are in schema `auth`. They are not tenant tables: no RLS, no grant to the app role. `createAuth` in `server/modules/tenancy/infrastructure/auth.ts` uses the auth-role URL, the organization plugin, and `creatorRole: 'admin'`. Ids are uuids (`crypto.randomUUID()`).
- `app.tenant_member` is owned by the migrator, `security_barrier` on, `security_invoker` off. It returns only `user_id`, `name`, and `role` where `organization_id` equals `app.current_tenant_id()::text`. The app role may `SELECT` the view and nothing else.

## Open notes

- Auth grants in `0001_auth_member_view.sql` are `GRANT ... ON ALL TABLES IN SCHEMA auth`. That covers tables that existed when the migration ran, not tables created later. There is no `ALTER DEFAULT PRIVILEGES`.
- Auth timestamps are `timestamp` without time zone (`db/auth-schema.ts`).
- Ticket #1 duplicates #5.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rls
pnpm db:generate
pnpm db:migrate:local
```

`pnpm test:rls` needs `DATABASE_URL` (app role) and `AUTH_DATABASE_URL` from the gitignored `.env`. `pnpm db:migrate:local` reads gitignored `.env.migrate` (`DATABASE_MIGRATE_URL`, owner role) and applies to the local database only. Do not print those files, commit them, or copy them to GitHub. Do not run `pnpm test:rls` from the hook.

`.husky/pre-commit` refuses a commit on `develop` or `main` unless `ALLOW_PROTECTED_BRANCH=1`, then runs lint-staged, `pnpm typecheck`, and `pnpm test`.

`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` ignores only GHSA-86w9-cpqp-85rv. node-forge is dev-only via listhen (dev-server self-signed cert), not in the production bundle. `pnpm exec nuxt build` then `rg -l node-forge .output` found nothing (454 files searched). Revisit when node-forge > 1.4.0 ships. The moderate esbuild advisory is not ignored.

## Remaining

Status: #9 is complete. Slices 2–5 are done. CI is `.github/workflows/ci.yml` and runs `pnpm audit --audit-level=high` after install. The import gate is `no-restricted-imports` in `eslint.config.mjs`, covered by `server/core/import-gate.test.ts`.

Stop after each slice with a short summary so the owner can commit.

### 2. pg-boss behind a port (done)

Enqueue uses the Drizzle transaction and pg-boss `fromDrizzle`, inside the tenant transaction. The job's Tenant comes from the context. Rollback removes the job. Application code reaches the queue through a port. This package registers no production job. `transferpro_queue` owns schema `pgboss` and has no grant on `app` or on Better Auth. `transferpro_app` has DML (not DDL) on `pgboss`.

### 3. Zod env and the boot check (done)

Validate environment at startup. The migrator URL is not part of the app environment. Boot refuses to start if any runtime role (`transferpro_app`, `transferpro_auth`, `transferpro_queue`) is superuser or has `BYPASSRLS`.

### 4. CI (done)

GitHub Actions on a pull request: lint, typecheck, unit tests, and the cross-tenant RLS suite. CI mints ephemeral role passwords in the job. Do not reuse local passwords.

## Rules

- TDD. Red before green. One slice at a time. The agreed seams are in ADR-0011 and issue #9. Do not assert policy SQL text.
- Keep the hook green: `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass. The RLS suite stays on CI and `pnpm test:rls`.
- No root-owned files. New files must be owned by the repo user.
- Stop after each slice. Do not commit unless the owner asks.
- Stop and show the owner before any change to `CHARTER.md` or a new ADR.
- One branch, one PR into `develop`. Do not commit on `develop` or `main`.
- No production access. No destructive DB operations. Migrations are committed for review and applied only to local and test databases.

## Suggested skills

- **tdd** for the next slice.
- **implement** for the rest of #9. Do not commit unless the owner asks.

Do not call **setup-pre-commit** (it installs Prettier; ADR-0011 forbids that). Do not call **domain-modeling** to write an ADR.
