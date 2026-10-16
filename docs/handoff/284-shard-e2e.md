# 284 Shard e2e and cache the Nuxt build

## Decisions

- CI keeps every Playwright spec. Three jobs run `--shard=1/3`, `--shard=2/3`, and `--shard=3/3` with `fail-fast: false`, so a red shard does not cancel the others. The `chromium` and `phone` projects both stay in the suite.
- `e2e-build` is the only job that runs `nuxi build`. It restores `.output` from the Actions cache (key is the lockfile plus app, server, shared, db, i18n, and public sources) and uploads the same directory as `nuxt-output`. Each shard downloads that artifact. A shard has no build step.
- `actions/setup-node` with `cache: pnpm` is the pnpm store cache on `fast`, `slow`, `e2e-build`, `e2e`, and `e2e-report`.
- On CI the reporter is `list` plus `blob`. Blob zip names include the shard index (`report-1.zip` …). `e2e-report` merges them into one html report. A local `pnpm test:e2e` stays the full suite and the html reporter.
- Role minting, `.env`, `.env.migrate`, and `pnpm db:migrate:local` live in `.github/actions/ci-database`. `slow` (RLS and backup) and each e2e shard use it. Shards do not run the RLS suite.
- `e2e` waits for `fast` and `e2e-build`. `e2e-build` runs beside `fast`.

## Before

Run [38927368815](https://github.com/prela/transferpro/actions/runs/38927368815) (`feature/264-catalog-pattern`, 206 tests, success), one `slow` job:

- `slow`: 15:53:47Z–16:06:51Z, 13m 4s
- End-to-end step (`nuxi build` plus the full Playwright run): 15:57:31Z–16:06:47Z, 9m 16s
- `nuxi build`: 15:57:31Z–15:58:04Z, about 33s
- Playwright: 206 passed in 8.7m, 2 workers

Run [38923750086](https://github.com/prela/transferpro/actions/runs/38923750086) (`slow` 15:26:57Z–15:36:33Z) was 9m 36s on the smaller suite.

## After

Not measured here. e2e was not run locally, and this branch was not pushed, so the sharded jobs have no CI duration yet. The number that belongs in the PR is the wall clock of the `e2e` matrix (start of the first shard through the end of the last), plus `e2e-report`.

## Tests

No spec added, removed, or weakened. `pnpm lint`, `pnpm typecheck`, and `pnpm test` (537) passed. `pnpm test:e2e` was not run.

No migration.
