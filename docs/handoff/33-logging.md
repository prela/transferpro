# Handoff: issue #33 logging

Status: implemented on `feature/33-logging`. Not committed. The owner said not to commit in this chat.

Fixed point before this slice: `d7fc831` (`d7fc83148d0ab7d2c678e9758de856b8d801cd41`), the merge of #9.

## Read first

1. `CHARTER.md` section "Observability and security baseline" (logging bullet only for this slice)
2. `docs/adr/0011-tenant-session.md` — do not re-decide the tenant session
3. `docs/handoff/9-foundation.md`
4. GitHub issue #33 (`gh issue view 33`)

## Decision

Pino. One logger module, `server/core/logger.ts`, reached only through `server/core/index.ts`. Pino writes one JSON line. Callers do not import pino. Redaction is a key list walked at any depth before the line is written. Pino's own path redaction stops at one level, so a nested passenger name would survive it.

`request_id` and `tenant_id` come from an async context the logger reads when it writes. A payload field of the same name is dropped, so a call site cannot invent either id.

## Done

- Redaction list: names, email, phone, flight number, address, price, notes, token, cookie, connection string. `user_id` is kept. Keys are compared with case and `_` / `-` ignored.
- `resolveRequestId` reuses `x-request-id` when it matches `^\w[\w.-]{0,127}$`. Anything else (blank, newline, email) is replaced with a new UUID. That format check is deliberate: a reused header must not break the JSON line or carry personal data. Noted on issue #33.
- `openRequestLog` binds that id for the rest of the request. `server/plugins/request-log.ts` echoes it on the response header. Plugin order is alphabetical: `boot.ts` configures the logger, then `request-log.ts` registers the hook.
- `openTenantSession` is the ADR-0011 tenant session. The kernel export takes a `TenantContext`, not a raw id. It runs `set_config('app.tenant_id', ..., true)` and the log scope together. The job handler uses an internal raw-id variant because the id comes from the envelope. `runWithTenantId` is not exported from `server/core/index.ts`. A log line outside that call has no `tenant_id`.
- Enqueue copies the current `request_id` onto the job envelope, next to `tenantId`, not inside `data`. `handleNext` restores it with `runWithRequestId` before `openTenantSession`, so the handler line has both ids. A job enqueued outside a request does not get an invented id.
- `LOG_LEVEL` is on `AppEnv`, parsed with Zod. Unset or blank: `info` when `NODE_ENV` is `production`, otherwise `debug`. An unknown level fails boot.
- `server/error.ts` is the Nitro `errorHandler` (`nuxt.config.ts`). It logs the error once through `handleLoggedError` and writes `{ statusCode, message, request_id }`. The message is a fixed phrase for that status, never `error.message` or the stack. Nitro's default handler is not called: in development it would put the stack in the body, and in production it `console.error`s the error.
- Secret keys are redacted when the normalized name contains `secret`, `token`, `password`, `cookie`, `authorization`, `apikey`, or `databaseurl`, so `BETTER_AUTH_SECRET` and `AUTH_DATABASE_URL` match. Personal-data keys stay exact. `detail` is exact: Postgres puts the row values there.
- ESLint `no-console` is an error everywhere except `server/core/logger.ts`. The logger does not call `console`. The error handler does not call `console.error`.

## Not in this slice

- Sentry / GlitchTip. The charter lists it separately. No DSN, no SDK.
- No new tenant table, no migration.
- Log messages and `Error.message` / `Error.stack` text are not scanned. Never interpolate a name, email, phone, flight number, or secret into them. Field names are what the redaction list sees. Postgres `detail` is a field, so it is redacted.
- HTTP handlers that open a tenant session must call `openTenantSession` with the kernel `TenantContext`, not `set_config` and not a raw id.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rls
```

`pnpm test` does not run the RLS suite. `pnpm test:rls` is required for this slice because `openTenantSession` is what the queue test uses to open the tenant session. The tenancy RLS files still call `set_config` themselves: they are catalog proofs, not application calls.

## Rules

- Do not commit unless the owner asks.
- Do not edit `CHARTER.md` or add an ADR for this slice. The charter line is already the spec.
- One branch, one PR into `develop`.
