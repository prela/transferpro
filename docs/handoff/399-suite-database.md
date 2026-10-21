# 399 Suite database guard

Out of scope: app code, and replacing the e2e localhost rewrite with a hard refuse of the source database name.

## Decisions

- `pnpm test:rls` loads `.env` and `.env.migrate`, then exits before vitest unless `DATABASE_URL`, `AUTH_DATABASE_URL`, `QUEUE_DATABASE_URL`, `PLATFORM_DATABASE_URL`, and `DATABASE_MIGRATE_URL` all name `transferpro_e2e`. A direct vitest run with `vitest.rls.config.ts` uses the same check. The message names the variable and leaves the URL out.
- The shell guard blocks `pnpm test:rls` and `pnpm test:e2e` when `DATABASE_URL` is set and the database is anything else, including a query key other than `sslmode`. A blank `DATABASE_URL` stays allowed, so the script can read `.env`.
- e2e still rewrites a localhost URL onto `transferpro_e2e` and exits when it cannot. That is the current local success path.
- CI creates `transferpro_e2e`, grants the roles, and points the suite URLs there before migrate. The service database `transferpro` stays the maintenance database.
- A URL that already names `transferpro_e2e` is still refused when a query key other than `sslmode` is set, because node-pg would connect to `host` or `hostaddr`.
- Checks on this branch: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (863), and `pnpm test:e2e` (302). The first e2e run had one `ECONNRESET` on the chromium stale-save spec (301 passed); the rerun passed 302. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; the high and critical findings are ignored). Local `pnpm test:rls` exited 1 with the refusal before vitest, because this checkout's `.env` names `transferpro`.
- The review below is of `205cd7f`. `0292305` answers it: the guard redacts a `DATABASE_URL` prefix before reprinting the command, the guard refuses a non-`sslmode` query key, the env load lives in one function, and the `AGENTS.md` line matches the e2e rewrite.

## Code review

Fixed point `1e9426b` (`origin/develop`). Both axes ran on the full model, not a fast one.

## Standards

### Hard

**`.cursor/hooks/guard-shell.mjs` — a refusal can print the URL.** `deny()` always appends the statement:

```1228:1231:.cursor/hooks/guard-shell.mjs
function deny(reason, command) {
  const shown = command.length > 160 ? `${command.slice(0, 160)}…` : command
  const message = shown
    ? `Blocked by the transferpro shell guard: ${reason} Command: ${shown}`
```

The new branch passes that statement through. `DATABASE_URL=postgres://transferpro_app:app-secret@127.0.0.1:5432/transferpro pnpm test:rls` therefore lands in `agent_message`, password included. The reason string itself is clean.

This breaks the script rule in `scripts/e2e-database.mjs`: the message names the variable and never the URL, so a secret is not printed. It also breaks `AGENTS.md` Security (do not print secrets; logs follow the same ban as audit). `docs/agents/working-rules.md` already treats a reprinted command line as a leak (`--password` is refused because pnpm reprints the command line). The new guard test only checks redaction when the URL is in `env`, not on the command line.

### Judgement

**Duplicated Code — load and assert.** The same three calls appear in `scripts/assert-rls-database.mjs` and `vitest.rls.config.ts`: `loadEnvFile('.env')`, `loadEnvFile('.env.migrate')`, `assertRlsDatabaseEnv(process.env)`.

**Duplicated Code — two URL parsers.** `postgresDatabaseName` in the guard re-reads `protocol` and `pathname`. `scripts/rls-database.mjs` already uses `databaseIdentity` and rejects every query key except `sslmode`. The guard copy does not, so `…/transferpro_e2e?host=…` is allowed by the hook and refused by the suite script. Keeping the hook free of `scripts/` is a fair reason to parse locally. The two decisions should still match.

Suite errors name the variable and do not interpolate the URL. Tests are added. `assertRlsDatabaseEnv` checks every name in `RLS_DATABASE_ENV`.

## Spec

### (a) Missing or partial

`test:e2e` does not refuse a database name other than `transferpro_e2e`. Spec: "`test:rls` and `test:e2e` refuse to start unless the target database name is `transferpro_e2e` (clear error, non-zero exit)." `package.json` is still `"test:e2e": "playwright test"`. `playwright.config.ts` calls `applyE2eDatabaseEnv`, which replaces a localhost database name with `transferpro_e2e` and continues. The usual `.env` names `transferpro` and does not export `DATABASE_URL`. The new guard treats a blank `DATABASE_URL` as allowed, so `pnpm test:e2e` still starts and rewrites.

The rule line is only half-stated. Spec: "One line in AGENTS.md / working rules stating the rule." `docs/agents/working-rules.md` says `pnpm test:rls` exits unless every suite URL names `transferpro_e2e`. The e2e bullet still says the harness rewrites those URLs.

`pnpm test:rls` does match "Running `pnpm test:rls` with `DATABASE_URL` on `transferpro` exits with the refusal and touches nothing." The preflight and `vitest.rls.config.ts` both refuse before any test file loads, including a name that comes only from `.env` or `.env.migrate`. The guard blocks `pnpm test:rls` and `pnpm test:e2e` when the process `DATABASE_URL` names another database.

### (b) Not asked for

`scripts/rls-database.mjs` refuses a URL that already names `transferpro_e2e` when any query key other than `sslmode` is set. Spec: "refuse to start unless the target database name is `transferpro_e2e`." A right name with `connect_timeout` or `application_name` now fails. The same check did not exist for RLS before.

### (c) Implemented, but wrong

`AGENTS.md` now says: "Both run only against the database `transferpro_e2e` and refuse any other database name." That is the required rule line, and it is false for e2e. A localhost URL whose database is `transferpro` is renamed in memory. It does not produce a clear error or a non-zero exit. Spec: "`test:e2e` refuse to start unless the target database name is `transferpro_e2e` (clear error, non-zero exit)."
