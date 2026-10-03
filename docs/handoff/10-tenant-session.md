# Handoff: issue #10 tenant session

Status: slice 1 is implemented on `feature/10-tenant-session`. Not committed. The owner said not to commit in this chat.

HEAD before this slice: `ceb8d1b` (develop, including the #33 logging merge and later dependency bumps).

## Read first

1. `docs/adr/0011-tenant-session.md` — do not re-decide the tenant session
2. `docs/handoff/9-foundation.md` and `docs/handoff/33-logging.md`
3. GitHub issue #10 (`gh issue view 10`)
4. This file

## Decision

No public signup in v1 (3.10.2026). An operator provisions the one pilot Tenant. Slice 2 is the sign-in screen.

## Done (slice 1)

- `pnpm tenant:create --name --slug --admin-email --admin-name`. The password is read from the terminal, or from the first line of stdin when there is no terminal. It is not an argument. The script does not write it. A duplicate slug or email exits 1 with a fixed sentence and does not repeat the email. A second run does not create a second Tenant.
- Roles. `AUTH_DATABASE_URL` must be `transferpro_auth`: user, credential, organization, admin member. That role has no grant on schema `app`. `DATABASE_MIGRATE_URL` must be `transferpro_owner` (`.env.migrate`): the one `app.tenant_settings` row, with `tenant_id` set explicitly, because the owner bypasses RLS and `app.current_tenant_id()` is null on that connection. The app role is not used. A wrong role exits before any insert.
- The new Tenant's time zone is `Europe/Zagreb` and its default locale is `hr`. Both are display. Instants are `timestamptz` UTC (`db/migrations/0003_auth_timestamptz.sql`, applied locally). A user's locale stays null until they choose one.
- Sign-in and sign-out go through Better Auth at `/api/auth/*`. The session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` (with the `__Secure-` name prefix) only when `NODE_ENV` is `production`.
- `emailAndPassword.disableSignUp` is on. `POST /api/auth/sign-up/email` returns 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`.
- `withTenantFromSession` (from `server/modules/tenancy`) reads the session, mints a `TenantContext`, and runs the callback inside `openTenantSession`. Log lines inside that callback have `request_id` and `tenant_id`. No session is 401. A session with no single membership, or a role other than `admin`, `dispatcher`, or `driver`, is 403. Both go through `handleLoggedError` / `server/error.ts`. A missing active organization still resolves when the user has exactly one membership.
- `GET /api/session` returns `{ tenantId }` for a signed-in member. No UI in this slice.

## Slice 2

Sign-in screen and signed-in shell, Croatian and English, light and dark, phone and desktop.

- Build on the cookie and `withTenantFromSession`. Replace `GET /api/session` with the shell; do not add a second way to open a tenant session.
- Do not turn public sign-up back on. Do not add a sign-up screen.
- The Tenant default locale is `hr`. A null user locale means that default (ADR-0011). The time zone `Europe/Zagreb` is for display only. Do not store pickup times as local wall time.
- `allowUserToCreateOrganization` is still Better Auth's default (`true`). A signed-in member can still call the create-organization endpoint. This slice did not disable it. Slice 2 should not grow that into a signup path.

## Commands

```bash
pnpm tenant:create --name "Pilot" --slug pilot --admin-email ada@example.com --admin-name Ada
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rls
```

`pnpm test:rls` needs `DATABASE_URL`, `AUTH_DATABASE_URL`, and `DATABASE_MIGRATE_URL`. The new RLS file loads `.env` and `.env.migrate` itself. Do not print those files. `pnpm db:migrate:local` applies `0003_auth_timestamptz.sql` with the owner role. CI already migrates before `pnpm test:rls`.

The script is `node --import ./scripts/register-ts.mjs`, because Node does not resolve the repo's extensionless TypeScript imports. `scripts/ts-loader.mjs` exists only for that command.

## Known limits

- The settings row is written before the login. If the login insert fails, that row is deleted. If the process dies between the two, an unused settings row remains and a retry still creates the Tenant with `Europe/Zagreb`.
- If someone passes `--password`, the script refuses it and does not write the value. pnpm's own failure line repeats the command, so the value appears there. Do not pass it.
- `GET /api/session` was typechecked and the helper behind it was tested. It was not requested through a running Nitro server. There is no screen to open.

## Rules

- Do not commit unless the owner asks.
- Do not edit `CHARTER.md` or add an ADR. Signup staying off is the issue, not a new decision record.
- One branch, one PR into `develop`.
- Stop after slice 2. Do not start another WP.
