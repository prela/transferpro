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
- **Module boundaries:** when adding a module, follow ADR-0018.
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

- `DATABASE_MIGRATE_URL` lives in gitignored `.env.migrate` and is the `transferpro_owner` role. It is not part of the app env. `.env` holds `DATABASE_URL` (`transferpro_app`) and `AUTH_DATABASE_URL` (`transferpro_auth`). Leave both files unprinted and uncommitted. `MAILER` and `RESEND_API_KEY` are documented in `.env.example`. Production boot requires `MAILER=resend` and the Resend key. Development omits both and uses the console mailer. Every Resend key on the account shares one daily quota, so `pnpm dev` must not send through Resend unless an operator sets both on purpose.
- `pnpm db:migrate:local` applies committed migrations with the owner role to the local database only.
- drizzle-kit cannot emit `FORCE ROW LEVEL SECURITY`. The migration SQL does, as in `db/migrations/0000_tenant_settings.sql`. Declaration stays `tenantTable()` (ADR-0011).
- `GRANT ... ON ALL TABLES IN SCHEMA auth` in `0001_auth_member_view.sql` covers tables that existed when it ran. There is no `ALTER DEFAULT PRIVILEGES`. A new `auth` table gets its grant in its own migration.
- Instants are `timestamptz` UTC. A Tenant time zone is display only. Pickup times stay instants.

## RLS and the tenant session

- `pnpm test` is the unit and integration suite. `pnpm test:rls` is the cross-tenant suite. It reads `.env` and `.env.migrate` itself. CI migrates, mints ephemeral role passwords, then runs it. Local passwords stay local.
- `pnpm test:rls` stays off the pre-commit hook (that hook is under Commit and branch flow). The suite runs in CI and when you invoke it.
- `pnpm test:e2e` is Playwright (Chromium) against the built app. It stays off the pre-commit hook. Build first with `pnpm exec nuxi build`. The harness starts `node .output/server/index.mjs` through `scripts/e2e-server.mjs` on `http://127.0.0.1:3000` (`E2E_PORT` changes the port), with `NODE_ENV=test` and `RESEND_API_KEY` unset. That script exits if either is wrong, and the app selects the fake mailer and refuses to boot if the Resend transport is active. It does not reuse a server that is already listening: `pnpm dev` is the console mailer unless `MAILER=resend` and the key are both set. Stop that process, or set `E2E_PORT`, before a local run. Specs assert Croatian copy, with one English smoke. The invite link is read from the screen. Every UI ticket adds or extends a spec under `e2e/`.
- Application code opens a session with a kernel `TenantContext`: HTTP handlers use `withTenantFromSession` (`server/modules/tenancy`); other callers use `openTenantSession`. Catalog RLS tests may call `set_config`; they prove the catalog. Assert behaviour, not policy SQL text.
- No session is 401. No single membership, or a role other than `admin`, `dispatcher`, or `driver`, is 403. Both go through `handleLoggedError`. One membership still resolves when the active organization is missing.
- Enqueue stores the current `request_id` on the job envelope beside `tenantId`, outside `data`. The handler restores it with `runWithRequestId` before `openTenantSession`. A job enqueued outside a request carries no invented id. `runWithTenantId` stays off `server/core/index.ts`.

## Audit log

Rationale is ADR-0014. Working rules:

- Append with `appendAuditEntry` from `server/modules/audit` on the action's own transaction, after its writes and before commit. That transaction needs a tenant session; on the auth pool, open `openTenantSession` on the same client, as `member-management.ts` does.
- A new action needs four things: a value in `auditActions` with a strict data shape (`shared/audit-entry.ts`), a matching branch in the `audit_entry_shape` check (`db/audit-entry.ts`), a migration that adds the enum value and replaces the check, and `audit.actions.*` copy in both locales. Without the branch, the table refuses the action's rows.
- Entry data holds ids, roles, and, for a settings change, the from/to values (ADR-0015). It does not hold names, emails, or invitation ids. Display names come from `app.tenant_member` when the log is read.
- The invite entry comes from the `auth.invitation` insert trigger, so invite code appends nothing.
- ADR-0014 amends ADR-0011: besides Better Auth's tables, the auth role may use schema `audit` and execute `audit.append_entry`, and nothing else outside `auth`.

## Logging and errors

The charter lists the personal-data keys. Rationale for the logger shape is ADR-0012 (proposed). Also:

- Import the logger from `server/core/index.ts`. `no-console` is an error except in `server/core/logger.ts`, and that file still does not call `console`. `server/error.ts` does not call `console.error`. A `console` call skips redaction. The personal-data and secret key list lives in `shared/redact.ts` and is shared with Sentry (#34).
- Personal-data keys match exactly, plus `notes`. `user_id` is kept. A normalized name containing `secret`, `token`, `password`, `cookie`, `authorization`, `apikey`, or `databaseurl` is redacted (`BETTER_AUTH_SECRET`, `AUTH_DATABASE_URL`, `RESEND_API_KEY`). `detail` is exact. Comparison ignores case and `_` / `-`. `invitationId` and `inviteUrl` are redacted whole. A string containing `accept-invite#<id>`, `accept-invite/<id>`, or `invitationId=<id>` is scrubbed, including in a message, because the id is a bearer secret (ADR-0013). Other personal data in a message stays unscanned.
- Put personal data and secrets in fields the list can see. Message text and `Error.message` are not scanned for personal data. The invitation-id patterns in the previous bullet are the exception, and they are scrubbed inside a message (ADR-0013).
- `server/plugins/boot.ts` configures the logger; `server/plugins/request-log.ts` echoes `x-request-id`. Nuxt runs plugins in alphabetical order, so those two names stay in that order.
- `LOG_LEVEL` on `AppEnv`: blank means `info` when `NODE_ENV` is `production`, otherwise `debug`. An unknown level fails boot.
- `server/error.ts` responds with `{ statusCode, message, request_id }`. `message` is a fixed phrase for that status. `handleLoggedError` writes a 4xx at `warn` and anything else at `error`.

## Audit ignores

`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` is the list. Add an id only for a dev-only or build-time advisory that is absent from the production bundle, and say in the comment why and when to revisit. The moderate esbuild advisory stays on the audited list. CI runs `pnpm audit --audit-level=high`.

## Provisioning

`pnpm tenant:create --name --slug --admin-email --admin-name` creates the pilot Tenant. Email sign-up stays disabled (`disableSignUp`). The password comes from the terminal, or from the first line of stdin when there is no terminal. It stays off the argument list and off disk. A duplicate slug or email exits 1 with a fixed sentence that omits the email.

The auth URL is `transferpro_auth` (no grant on schema `app`). The migrate URL is `transferpro_owner`, which sets `tenant_id` on `app.tenant_settings` explicitly because that role bypasses RLS. A wrong role exits before any insert. The script sets time zone `Europe/Zagreb`, `default_locale` `hr`, an airport wait of 90 minutes, and a wait of 25 minutes elsewhere. The settings row is written before the login and removed if the login insert fails. A crash between the two can leave an unused settings row; a retry still creates the Tenant.

It runs as `node --import ./scripts/register-ts.mjs`. `scripts/ts-loader.mjs` exists for that command. Passing `--password` is refused; pnpm then reprints the command line, so the value would appear there.

## Invitations

`disableSignUp` stays on. The operator script and `POST /api/invitations/accept` are the only account-creation paths in the app (ADR-0013). Tests and `e2e/` may insert credential rows through `server/modules/tenancy/testing.ts`. `server/api` and `app` must not import that file. Accepting creates an account only for a pending, unexpired, unused invitation, and the email is copied from that row. An email that already has an account signs in and then accepts; the route does not change that password. An invitation lasts 7 days. The link keeps the id in the URL hash. Only an admin may invite. `POST /api/invitations/accept` uses the same production limit as email sign-in. Resend sends from `noreply@transfers.prela.net` through the mailer port. Production requires `MAILER=resend` and `RESEND_API_KEY`. Development uses the console mailer unless both are set; the Resend key is not required to boot. A failed send still returns the copyable invite link and `invite.emailFailed` in both locales. The domain region is `eu-west-1`; Resend stores account logs in the US. Invitations are read in a tenant session through `app.tenant_invitation`, which does not return the email.

## Superadmin

ADR-0019. A superadmin is a Better Auth user with a row in `platform.superadmin` and no membership. `pnpm superadmin:create --name --email` and `pnpm superadmin:revoke --email` are the only writers of that row. The password is read like `tenant:create`. `--password` is refused. A duplicate email, an existing membership, or an existing grant exits 1 with a fixed sentence that omits the email.

`pnpm tenant:account --slug <slug> --deactivate` and `--reactivate` are the emergency lever. There is no suspend UI or API in v1. A deactivated firm's members get the ordinary 403 on the next request. Invitation accept for that firm is refused and creates no user. Sessions are not deleted.

Platform screens list firms, open one, and rename it. Open shows name, slug, created time, and active. It never shows clients, drivers, vehicles, rides, transfers, members, or audit. Rename appends `tenant.renamed` with empty data. List and open append nothing. The lever appends `tenant.suspended` or `tenant.reactivated` with empty data and actor `transferpro_owner`, which is the role name, not a person.

`transferpro_platform` is `NOBYPASSRLS`, has no `USAGE` on schema `app`, and has column grants only. `PLATFORM_DATABASE_URL` is that role. Boot refuses any other role on that URL and refuses `USAGE` on schema `app`. The migrator URL stays out of `AppEnv`.

A superadmin session lasts 8 hours (`SUPERADMIN_SESSION_SECONDS`). There is no second factor in v1. Every platform route logs `userId`, `action`, `targetTenantId`, and `outcome`, and does not log names or bodies. `targetTenantId` is not the `tenant_id` log scope. Rate limiting those routes is backlog.

## Tenant settings

`app.tenant_settings` already has FORCE RLS, so another Tenant cannot read or write the row. The waits and the time zone are columns on that row.

A new Tenant starts at a 90-minute airport wait, a 25-minute wait elsewhere, and `Europe/Zagreb`. The migration's column defaults are the same, so an existing row gains them. Bounds are 1 to 1440 minutes: one minute is still a wait, and a day is as long as a No-show wait can be before the Ride is forgotten. The time zone is an IANA name from `Intl.supportedValuesOf('timeZone')`.

An admin changes them with `PATCH /api/tenant-settings`. A dispatcher and a driver may `GET` them and receive 403 on a change: ADR-0007 has the Driver wait them out and the Dispatcher close a No-show early. A no-op or a refused change appends no audit entry. A real change appends one entry per field, in the same transaction, with `{ from, to }` only.

## i18n and theme

`@nuxtjs/i18n` uses `strategy: 'no_prefix'` and `detectBrowserLanguage: false`. Copy is `i18n/locales/hr.json` and `en.json`. Croatian is the default. A null user locale follows the Tenant default. `POST /api/locale` accepts `hr` or `en`.

`formatInstant` (`shared/format-instant.ts`) renders a UTC instant in the Tenant time zone: Croatian wall time for `hr`, en-GB for `en`.

Theme follows the system unless `transferpro-theme` is `light` or `dark`. `@nuxtjs/color-mode`, registered by Nuxt UI, reads that key and applies the choice before paint (ADR-0016). Screens are Nuxt UI components. Nuxt UI is the only UI library. When it lacks a component, build it from the Reka UI primitives Nuxt UI already uses, and style it with Nuxt UI theme tokens. Do not add shadcn-vue or another kit. Icons come from the installed `@iconify-json/lucide` set. `icon.fallbackToApi` stays false, so an icon is not fetched from a CDN at runtime. Inputs are labeled, 16px, and submit with Enter.

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

Scripts live in `package.json`. `pnpm dev` is the local app on port 3000. `pnpm test:e2e` is Playwright; build first. One invocation that file does not show:

```bash
docker compose up -d  # local Postgres
pnpm exec nuxi build  # the app Playwright starts
```

## Definition of done (per PR)

- Tests written first and green; lint, typecheck, coverage pass in CI.
- A UI change adds or extends a Playwright spec in `e2e/`.
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
