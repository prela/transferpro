# Working rules

Area detail for the pointer in `AGENTS.md`. That file is the source and wins if a line here disagrees.

## Database roles and migrations

Roles, grants, and the tenant session are ADR-0011. Working rules on top of that:

- `DATABASE_MIGRATE_URL` lives in gitignored `.env.migrate` and is the `transferpro_owner` role. It is not part of the app env. `.env` holds `DATABASE_URL` (`transferpro_app`) and `AUTH_DATABASE_URL` (`transferpro_auth`).
- `pnpm db:migrate:local` applies committed migrations with the owner role to the local database only. Apply one migration at a time.
- In `db/migrations/meta/_journal.json`, set the new entry's `when` to the previous entry's `when` plus 1000. The values are synthetic. A smaller value is silently skipped.
- drizzle-kit cannot emit `FORCE ROW LEVEL SECURITY`. The migration SQL does, as in `db/migrations/0000_tenant_settings.sql`. Declaration stays `tenantTable()` (ADR-0011).
- `GRANT ... ON ALL TABLES IN SCHEMA auth` in `0001_auth_member_view.sql` covers tables that existed when it ran. There is no `ALTER DEFAULT PRIVILEGES`. A new `auth` table gets its grant in its own migration.
- Instants are `timestamptz` UTC. A Tenant time zone is display only. Pickup times stay instants.

## RLS and the tenant session

- `pnpm test:rls` reads `.env` and `.env.migrate` itself, then exits before vitest unless every suite URL names the database `transferpro_e2e`. CI migrates that database, mints ephemeral role passwords, then runs it. Local passwords stay local.
- `pnpm test:e2e` is Playwright (Chromium) against the built app. Build first with `pnpm exec nuxi build`. The harness rewrites `DATABASE_URL`, `AUTH_DATABASE_URL`, `QUEUE_DATABASE_URL`, `PLATFORM_DATABASE_URL`, and `DATABASE_MIGRATE_URL` in memory to the database `transferpro_e2e` on localhost. `e2e/prepare-database.ts` drops and recreates that database, grants the roles, and migrates it. It does not connect to the dev database `transferpro`. `scripts/e2e-server.mjs` then starts `node .output/server/index.mjs` on `http://127.0.0.1:3000` (`E2E_PORT` changes the port), with `NODE_ENV=test` and `RESEND_API_KEY` unset, and exits unless every app URL names `transferpro_e2e` on localhost. It deletes `DATABASE_MIGRATE_URL` before the app starts. The app selects the fake mailer and refuses to boot if the Resend transport is active. It does not reuse a server that is already listening. Stop that process, or set `E2E_PORT`, before a local run. The maintenance login defaults to `postgres` / `postgres` (`E2E_ADMIN_USER`, `E2E_ADMIN_PASSWORD`). Specs assert Croatian copy, with one English smoke. The invite link is read from the screen. Local `pnpm test:e2e` runs the full suite. CI runs the same suite as three Playwright shards against one cached `.output`; it does not drop a spec. Each shard has its own Postgres service, so each prepare owns its own `transferpro_e2e`.
- Application code opens a session with a kernel `TenantContext`: HTTP handlers use `withTenantFromSession` (`server/modules/tenancy`); other callers use `openTenantSession`. Catalog RLS tests may call `set_config`; they prove the catalog. Assert behaviour, not policy SQL text.
- No session is 401. No single membership, or a role other than `admin`, `dispatcher`, or `driver`, is 403. Both go through `handleLoggedError`. One membership still resolves when the active organization is missing.
- Enqueue stores the current `request_id` on the job envelope beside `tenantId`, outside `data`. The handler restores it with `runWithRequestId` before `openTenantSession`. A job enqueued outside a request carries no invented id. `runWithTenantId` stays off `server/core/index.ts`.

## Audit log

Rationale is ADR-0014. Working rules:

- Append with `appendAuditEntry` from `server/modules/audit` on the action's own transaction, after its writes and before commit. That transaction needs a tenant session; on the auth pool, open `openTenantSession` on the same client, as `member-management.ts` does.
- A new action needs four things: a value in `auditActions` with a strict data shape (`shared/audit-entry.ts`), a matching branch in the `audit_entry_shape` check (`db/audit-entry.ts`), a migration that adds the enum value and replaces the check, and `audit.actions.*` copy in both locales. Without the branch, the table refuses the action's rows.
- Entry data holds ids, roles, and, for a settings change, the from/to values (ADR-0015). It does not hold invitation ids. Display names come from `app.tenant_member` when the log is read.
- The invite entry comes from the `auth.invitation` insert trigger, so invite code appends nothing.
- ADR-0014 amends ADR-0011: besides Better Auth's tables, the auth role may use schema `audit` and execute `audit.append_entry`, and nothing else outside `auth`.

## Logging and errors

The charter lists the personal-data keys. Rationale for the logger shape is ADR-0012. Also:

- Import the logger from `server/core/index.ts`. `no-console` is an error except in `server/core/logger.ts`, and that file still does not call `console`. `server/error.ts` does not call `console.error`. A `console` call skips redaction. The personal-data and secret key list lives in `shared/redact.ts` and is shared with Sentry (#34).
- Personal-data keys match exactly, plus `notes`. `user_id` is kept. A normalized name containing `secret`, `token`, `password`, `cookie`, `authorization`, `apikey`, or `databaseurl` is redacted (`BETTER_AUTH_SECRET`, `AUTH_DATABASE_URL`, `RESEND_API_KEY`). `detail` is exact. Comparison ignores case and `_` / `-`. `invitationId` and `inviteUrl` are redacted whole. A string containing `accept-invite#<id>`, `accept-invite/<id>`, or `invitationId=<id>` is scrubbed, including in a message, because the id is a bearer secret (ADR-0013). Other personal data in a message stays unscanned, and so does `Error.message`. Put personal data and secrets in fields the list can see.
- `server/plugins/boot.ts` configures the logger; `server/plugins/request-log.ts` echoes `x-request-id`. Nuxt runs plugins in alphabetical order, so those two names stay in that order.
- `LOG_LEVEL` on `AppEnv`: blank means `info` when `NODE_ENV` is `production`, otherwise `debug`. An unknown level fails boot.
- `server/error.ts` responds with `{ statusCode, message, request_id }`. `message` is a fixed phrase for that status. `handleLoggedError` writes a 4xx at `warn` and anything else at `error`.

## Audit ignores

`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` is the list. Add an id only for a dev-only or build-time advisory that is absent from the production bundle, and say in the comment why and when to revisit. The moderate esbuild advisory stays on the audited list.

## Provisioning

`pnpm tenant:create --name --slug --admin-email --admin-name` creates the pilot Tenant. The password comes from the terminal, or from the first line of stdin when there is no terminal. It stays off the argument list and off disk. A duplicate slug or email exits 1 with a fixed sentence that omits the email.

The auth URL is `transferpro_auth` (no grant on schema `app`). The migrate URL is `transferpro_owner`, which sets `tenant_id` on `app.tenant_settings` explicitly because that role bypasses RLS. A wrong role exits before any insert. The script sets `default_locale` `hr` and the Tenant settings defaults. The settings row is written before the login and removed if the login insert fails. A crash between the two can leave an unused settings row; a retry still creates the Tenant.

`scripts/ts-loader.mjs` is what `scripts/register-ts.mjs` loads. Passing `--password` is refused; pnpm then reprints the command line, so the value would appear there.

## Invitations

`disableSignUp` stays on. The operator script and `POST /api/invitations/accept` are the only account-creation paths in the app (ADR-0013). Tests and `e2e/` may insert credential rows through `server/modules/tenancy/testing.ts`. `server/api` and `app` must not import that file. Accepting creates an account only for a pending, unexpired, unused invitation, and the email is copied from that row. An email that already has an account signs in and then accepts; the route does not change that password. An invitation lasts 7 days. The link keeps the id in the URL hash. Only an admin may invite. `POST /api/invitations/accept` uses the same production limit as email sign-in. Resend sends from `noreply@transfers.prela.net` through the mailer port. Production requires `MAILER=resend` and `RESEND_API_KEY`, unless `ALLOW_CONSOLE_MAILER` is exactly `1` and `MAILER` is `console` (ADR-0037). Preview sets `MAILER=resend`, `RESEND_API_KEY`, and `MAIL_ALLOWLIST` (ADR-0042). `DEPLOY_ENV` is `preview`, `production`, or unset (ADR-0043). A blank value is unset, and any other value fails boot without echoing it. Boot requires `MAIL_ALLOWLIST` when `DEPLOY_ENV` is `preview`. Preview sets `DEPLOY_ENV=preview`. Unset and `production` leave the list optional. `NODE_ENV` stays `production` for both preview and production. `MAIL_ALLOWLIST` is a comma-separated list of emails, trimmed and compared case-insensitively. With the list set, only those recipients reach Resend; every other recipient is today's console line, for every kind of mail. A blank entry or an invalid email fails boot, and the message does not echo the value. Production leaves the list unset. The Resend key is not required to boot when the console mailer is selected. The invite mail goes through the mail outbox (ADR-0045). Better Auth creates the invitation and sends nothing: `sendInvitationEmail` is not set, and its `/organization/invite-member` HTTP route stays disabled. Better Auth writes on the auth pool and the entry is on the app pool, so they cannot share one transaction (ADR-0047): the Admin check runs on a tenant transaction that commits before Better Auth is called; after Better Auth commits, one tenant transaction writes the entry (kind `invitation`, the invitation id only) and its one-minute job, and another makes the first attempt, which the invite call waits for. `POST /api/invitations` always returns the copyable link and `mail`: `sent`, `retrying` (`invite.emailRetrying`), `stale` (`invite.emailStale`), or `not_sent` (`invite.emailFailed`) when the entry could not be written; nothing retries it, and the one `mail_outbox.invitation_not_recorded` log line carries neither the address nor the id. Every attempt composes from the invitation (email, role), the Tenant name, and the Tenant default locale. An invitation is current while it is pending and unexpired. Home lists a failed, still-pending invitation to the Admin only, with the invitee's email read on request from the auth role. The Home read and `POST /api/office-home/failed-mail/:entryId/resend` name the outbox entry, never the invitation id; a dispatcher's resend of an invitation is 403. No audit entry for a send or a resend. The domain region is `eu-west-1`; Resend stores account logs in the US. `app.tenant_invitation` is the app-role read and does not return the email. `GET /api/invitations` is Admin only and returns the Tenant's pending invitations (email, role, expiry) by calling Better Auth on the server. `POST /api/invitations/:invitationId/revoke` cancels one pending invitation in the same transaction as `member.invitation_revoked`, which stores the role only (ADR-0041). The Tenant comes from the session. A dispatcher, a driver, and a signed-out request are refused. Better Auth's `/organization/list-invitations` HTTP route stays disabled.

## Sign-in

Sign-in and sign-out are Better Auth at `/api/auth/*`. Keep the session cookie `httpOnly` and `SameSite=Lax`, with `Secure` and the `__Secure-` prefix when `NODE_ENV` is `production`. One failure message for every status except 429. Keep the production limit on `/sign-in/email` (3 requests per 10 seconds, `signInRateLimit`). Changing any of these needs an ADR.

## Superadmin

ADR-0019. A superadmin is a Better Auth user with a row in `platform.superadmin` and no membership. `pnpm superadmin:create --name --email` and `pnpm superadmin:revoke --email` are the only writers of that row. `pnpm superadmin:password --email` sets a new password for that grant and deletes every session of that user in the same transaction (ADR-0042). It is not a recovery path for a Member, a user without the grant, or an unknown email: each exits 1 with one fixed sentence that omits the email. The password is read like `tenant:create`. `--password` is refused. A duplicate email, an existing membership, or an existing grant exits 1 with a fixed sentence that omits the email.

`pnpm tenant:account --slug <slug> --deactivate` and `--reactivate` are the emergency lever. There is no suspend UI or API in v1. A deactivated firm's members get the ordinary 403 on the next request. Invitation accept for that firm is refused and creates no user. Sessions are not deleted.

Platform screens list firms, open one, and rename it. Open shows name, slug, created time, and active. It never shows clients, drivers, vehicles, rides, transfers, members, or audit. Rename appends `tenant.renamed` with empty data. List and open append nothing. The lever appends `tenant.suspended` or `tenant.reactivated` with empty data and actor `transferpro_owner`, which is the role name, not a person.

`transferpro_platform` is `NOBYPASSRLS`, has no `USAGE` on schema `app`, and has column grants only. `PLATFORM_DATABASE_URL` is that role. Boot refuses any other role on that URL and refuses `USAGE` on schema `app`. The migrator URL stays out of `AppEnv`.

A superadmin session lasts 8 hours (`SUPERADMIN_SESSION_SECONDS`). There is no second factor in v1. Every platform route logs `userId`, `action`, `targetTenantId`, and `outcome`, and does not log names or bodies. `targetTenantId` is not the `tenant_id` log scope. Rate limiting those routes is backlog.

## Tenant settings

`app.tenant_settings` already has FORCE RLS, so another Tenant cannot read or write the row. The waits and the time zone are columns on that row.

A new Tenant starts at a 90-minute airport wait, a 25-minute wait elsewhere, and `Europe/Zagreb`. The migration's column defaults are the same, so an existing row gains them. Bounds are 1 to 1440 minutes: one minute is still a wait, and a day is as long as a No-show wait can be before the Ride is forgotten. The time zone is an IANA name from `Intl.supportedValuesOf('timeZone')`.

An admin changes them with `PATCH /api/tenant-settings`. A dispatcher and a driver may `GET` them and receive 403 on a change: ADR-0007 has the Driver wait them out and the Dispatcher close a No-show early. A no-op or a refused change appends no audit entry. A real change appends one entry per field, in the same transaction, with `{ from, to }` only.

The operational-day start is a whole hour from 0 through 8 on the same row, default 5. The board and Home pass that hour into the shared operational-day bound. The roster and expiring documents stay on the calendar date. A real change appends `settings.operational_day_start_changed`. An unchanged hour appends nothing.

The transfer duration and the relocation gap are whole minutes from 1 through 1440 on the same row. A new Tenant, and one that already exists, starts at 60 and 15. A real change appends `settings.transfer_duration_changed` or `settings.relocation_gap_changed`. These are not No-show waits (ADR-0029).

## i18n and theme

A null user locale follows the Tenant default. `POST /api/locale` accepts `hr` or `en`. Ship both locales for every UI change. Ship both light and dark. `nuxt.config.ts` holds the locale strategy and the `transferpro-theme` key. Render instants with `formatInstant` (`shared/format-instant.ts`); do not add another date formatter.

Screens are Nuxt UI components. Nuxt UI is the only UI library. When it lacks a component, build it from the Reka UI primitives Nuxt UI already uses, and style it with Nuxt UI theme tokens. Do not add shadcn-vue or another kit. Icons come from the installed `@iconify-json/lucide` set. `icon.fallbackToApi` stays false, so an icon is not fetched from a CDN at runtime. Inputs are labeled, 16px, and submit with Enter.

When building or changing a screen, layout, or theme, open `.agents/skills/nuxt-ui/SKILL.md` and then the layout or guideline it names. For a component's props, slots or examples, use the `nuxt-ui` MCP tools (`get-component` with `sections`, `get-component-metadata`) before reading `node_modules`.

## Shell guard

The shell hook's input and output are the Cursor hook JSON: `permission` is `allow` or `deny`, and a denial sets `user_message` and `agent_message`.

If node or the guard script crashes, every agent shell command is denied. Repair the script, or temporarily remove the hook entry locally. The guard needs `sh` and `node`. On Windows, run Cursor in WSL or Git Bash. Project hooks do not run during an early read-only turn.

The guard stats `/run/cursor/api.sock` and does not read the socket, so a shell export of `CURSOR_AGENT_SOCKET` cannot point the check at another file. The hook input `conversation_id` arrives on stdin; a shell export cannot set it. The guard treats a command prefix and `export` as text, not as its own environment. The worker id stays a residual risk if a hook runner both inherited the shell and already had a `bc-` conversation id.

The guard does not see past the command string. It will not catch a runtime read (`node -e` with a file read), `sed` or `awk` on `.env`, `eval`, a variable that expands to `.env`, `git show` of a secret path, deleting `node_modules` by renaming it first, or `corepack pnpm` / `npx pnpm`.

Checks live in `.cursor/hooks/*.checks.mjs` and use `node:test`. A `*.test.*` name makes ESLint rewrite that import to vitest. New files are owned by the repo user. Prettier stays uninstalled (ADR-0011); the setup-pre-commit skill would install it.

## Skill workflow

1. **Wayfinder** — project → work packages as GitHub issues (done once, refreshed when scope changes).
2. **grill-with-docs** — per piece; update `GLOSSARY.md` and write or update ADRs.
3. **tdd** — red–green–refactor for the slice.

The skills under `.agents/skills/` are the third-party pack. `skills-lock.json` tracks that pack only.

## Commands

Local Postgres is not a `package.json` script:

```bash
docker compose up -d
```
