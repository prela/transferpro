# AGENTS.md

Instructions for Cursor agents working in the `transferpro` repo.

## Read first, in this order

1. `CHARTER.md` — goal, scope, v1 slice, rules, WBS. Owner-locked.
2. `GLOSSARY.md` — ubiquitous language. Use its terms in code, tests, and tickets (Transfer vs Ride, Client vs Partner, Tenant).
3. `docs/adr/` — accepted decisions. Do not contradict an ADR; propose a new one.
4. The GitHub issue for your WP.
5. `docs/handoff/<issue>-<slug>.md` when that ticket has one. `docs/handoff/README.md` says when to delete it.

## Hard rules

- **Tenant isolation:** every tenant table has `tenant_id` and an RLS policy, plus a test proving Tenant A cannot read or write Tenant B's rows. No exceptions without an ADR.
- **No production access.** Never connect to, deploy to, or read secrets of production.
- **No destructive DB operations** (drop, truncate, mass delete/update, destructive migrations). Every migration goes in the PR for owner review; never apply it outside local/test DBs.
- **No deep imports** across modules or Tiers. Import only from a module's `index.ts`. Domain/application never import Drizzle, Better Auth, Nuxt, or the queue directly; they use ports.
- **Tests first.** Red before green for domain and application code. Lint and typecheck 0 errors; coverage 80% global, 95% domain + application services.
- **Zod at every runtime boundary** (env, request bodies, query params, imported bookings).
- **One WP = one `feature/<wp>-<slug>` branch = one PR into `develop`.** Never commit to `develop` or `main`. Claim a WP only when its dependencies are merged.
- **Conventional Commits.** Do not hand-edit `CHANGELOG.md`; it is generated.
- **Blocked? Stop.** Write what blocks you on the ticket; do not start another WP, do not guess.
- **Never edit `CHARTER.md`** without owner approval: propose a diff, reason, and impact, then wait.
- Stay inside v1 scope. Non-goals in the Charter are out of bounds unless a WP says so.
- No global installs; use repo scripts only.

## Database roles and migrations

Roles, grants, and the tenant session are ADR-0011. Working rules on top of that:

- `DATABASE_MIGRATE_URL` lives in gitignored `.env.migrate` and is the `transferpro_owner` role. It is not part of the app env. `.env` holds `DATABASE_URL` (`transferpro_app`) and `AUTH_DATABASE_URL` (`transferpro_auth`). Leave both files unprinted and uncommitted.
- `pnpm db:migrate:local` applies committed migrations with the owner role to the local database only.
- drizzle-kit cannot emit `FORCE ROW LEVEL SECURITY`. The migration SQL does, as in `db/migrations/0000_tenant_settings.sql`. Declaration stays `tenantTable()` (ADR-0011).
- `GRANT ... ON ALL TABLES IN SCHEMA auth` in `0001_auth_member_view.sql` covers tables that existed when it ran. There is no `ALTER DEFAULT PRIVILEGES`. A new `auth` table gets its grant in its own migration.
- Instants are `timestamptz` UTC. A Tenant time zone is display only. Pickup times stay instants.

## RLS and the tenant session

- `pnpm test` is the unit and integration suite. `pnpm test:rls` is the cross-tenant suite. It reads `.env` and `.env.migrate` itself. CI migrates, mints ephemeral role passwords, then runs it. Local passwords stay local.
- `pnpm test:rls` stays off the pre-commit hook (that hook is under Commit and branch flow). The suite runs in CI and when you invoke it.
- Application code opens a session with a kernel `TenantContext`: HTTP handlers use `withTenantFromSession` (`server/modules/tenancy`); other callers use `openTenantSession`. Catalog RLS tests may call `set_config`; they prove the catalog. Assert behaviour, not policy SQL text.
- No session is 401. No single membership, or a role other than `admin`, `dispatcher`, or `driver`, is 403. Both go through `handleLoggedError`. One membership still resolves when the active organization is missing.
- Enqueue stores the current `request_id` on the job envelope beside `tenantId`, outside `data`. The handler restores it with `runWithRequestId` before `openTenantSession`. A job enqueued outside a request carries no invented id. `runWithTenantId` stays off `server/core/index.ts`.

## Logging and errors

The charter lists the personal-data keys. Rationale for the logger shape is ADR-0012 (proposed). Also:

- Import the logger from `server/core/index.ts`. `no-console` is an error except in `server/core/logger.ts`, and that file still does not call `console`. `server/error.ts` does not call `console.error`. A `console` call skips redaction.
- Personal-data keys match exactly, plus `notes`. `user_id` is kept. A normalized name containing `secret`, `token`, `password`, `cookie`, `authorization`, `apikey`, or `databaseurl` is redacted (`BETTER_AUTH_SECRET`, `AUTH_DATABASE_URL`). `detail` is exact. Comparison ignores case and `_` / `-`.
- Put personal data and secrets in fields the list can see. Message text and `Error.message` are not scanned.
- `server/plugins/boot.ts` configures the logger; `server/plugins/request-log.ts` echoes `x-request-id`. Nuxt runs plugins in alphabetical order, so those two names stay in that order.
- `LOG_LEVEL` on `AppEnv`: blank means `info` when `NODE_ENV` is `production`, otherwise `debug`. An unknown level fails boot.
- `server/error.ts` responds with `{ statusCode, message, request_id }`. `message` is a fixed phrase for that status.

## Audit ignores

`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` is the list. Add an id only for a dev-only or build-time advisory that is absent from the production bundle, and say in the comment why and when to revisit. The moderate esbuild advisory stays on the audited list. CI runs `pnpm audit --audit-level=high`.

## Provisioning

`pnpm tenant:create --name --slug --admin-email --admin-name` creates the pilot Tenant. Email sign-up stays disabled (`disableSignUp`). The password comes from the terminal, or from the first line of stdin when there is no terminal. It stays off the argument list and off disk. A duplicate slug or email exits 1 with a fixed sentence that omits the email.

The auth URL is `transferpro_auth` (no grant on schema `app`). The migrate URL is `transferpro_owner`, which sets `tenant_id` on `app.tenant_settings` explicitly because that role bypasses RLS. A wrong role exits before any insert. The script sets time zone `Europe/Zagreb` and `default_locale` `hr`. The settings row is written before the login and removed if the login insert fails. A crash between the two can leave an unused settings row; a retry still creates the Tenant.

It runs as `node --import ./scripts/register-ts.mjs`. `scripts/ts-loader.mjs` exists for that command. Passing `--password` is refused; pnpm then reprints the command line, so the value would appear there.

## i18n and theme

`@nuxtjs/i18n` uses `strategy: 'no_prefix'` and `detectBrowserLanguage: false`. Copy is `i18n/locales/hr.json` and `en.json`. Croatian is the default. A null user locale follows the Tenant default. `POST /api/locale` accepts `hr` or `en`.

`formatInstant` (`shared/format-instant.ts`) renders a UTC instant in the Tenant time zone: Croatian wall time for `hr`, en-GB for `en`.

Theme follows the system unless `transferpro-theme` is `light` or `dark`. The shell is semantic HTML in `app/assets/shell.css`. Inputs are labeled, 16px, and submit with Enter.

Sign-in and sign-out are Better Auth at `/api/auth/*`. The session cookie is `httpOnly` and `SameSite=Lax`, and `Secure` with the `__Secure-` prefix only when `NODE_ENV` is `production`. A failed sign-in shows one message for every status except 429. Production limits `/sign-in/email` to 3 requests per 10 seconds (`signInRateLimit`). Development leaves the limiter off.

## Commit and branch flow

`.husky/pre-commit` refuses a commit on `develop` or `main` unless `ALLOW_PROTECTED_BRANCH=1`, then runs lint-staged, `pnpm typecheck`, and `pnpm test`. Commit when the owner asks. New files are owned by the repo user.

Formatting is Antfu ESLint via lint-staged (`eslint --fix`). Prettier stays uninstalled (ADR-0011); the setup-pre-commit skill would install it.

## Skill workflow

1. **Wayfinder** — project → WPs as GitHub issues (done once, refreshed when scope changes).
2. **grill-with-docs** — per piece; update `GLOSSARY.md` and write/update ADRs.
3. **architect** (pstack) — per WP: types, signatures, module structure. **Owner approves before code.**
4. **tdd** — implement red–green–refactor; open one PR.
5. **blast-radius** — before merging anything touching auth, RLS, migrations, jobs, or shared schemas.

## Commands

Scripts live in `package.json`. Two invocations that file does not show:

```bash
pnpm exec nuxi dev    # local app; there is no pnpm dev script
docker compose up -d  # local Postgres
```

## Definition of done (per PR)

- Tests written first and green; lint, typecheck, coverage pass in CI.
- RLS tests for any new tenant table.
- `GLOSSARY.md` / ADR updated if a term or decision changed.
- PR description: WP id, what changed, what it could break, migration notes.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `prela/transferpro`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
