# 282 platform tenants list

## Leftover audit rows

The local dev database `transferpro` still holds the audit rows of e2e companies that were deleted before this change. The owner counted about 12,972 of those rows. A trigger blocks deleting them. This slice does not delete them, and it does not connect e2e to that database. Later e2e runs use `transferpro_e2e` only.

## What changed

`GET /api/platform/tenants` returns one page of 20 firms, ordered by name then slug, plus `page`, `pageSize`, and `total`. `q` matches a name or a slug. `%`, `_`, and `!` are literal characters. A bad query is 400 and is not logged. `/admin/tenants` searches and pages in both locales.

`pnpm test:e2e` rewrites the database URLs in memory to `transferpro_e2e` on localhost. `e2e/prepare-database.ts` drops and recreates that database, then migrates it. `scripts/e2e-server.mjs` refuses to start unless every app URL names `transferpro_e2e` on localhost. A remote host is refused before any rewrite. `AGENTS.md` allows this drop for that database only.

## Tests

- `shared/platform-account.test.ts` — page size, search query, refused query.
- `scripts/e2e-database.test.mjs` — rewrite, refuse the dev name, refuse a remote host, maintenance login.
- `server/api/platform/platform.rls.test.ts` — one page of a search, literal `%` and `_`, 400 after the gate.
- `e2e/platform.spec.ts` and `e2e/platform-name.spec.ts` search for the firm before opening it.

No migration. No test was weakened or removed.
