# 284 Shard e2e and cache the Nuxt build

Out of scope: removing or rewriting e2e specs.

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

The sharded CI jobs have no duration until this branch's workflow finishes. The number to record is the wall clock of the `e2e` matrix, from the first shard start through the last shard end.

## Tests

No spec added, removed, or weakened. Conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (537) passed, then `E2E_PORT=30284 PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` — 202 passed (2.7m). Port 3000 was left free.

No migration.

## Code review

Fixed point `origin/develop`. The reports below are the review of `a01606e`.

### Standards

`origin/develop` is `9cf384b4`. The diff is one commit, `a01606e`, and is non-empty.

**Hard violations:** none. The new `ci-database` action still mints role passwords, masks them, writes gitignored `.env` and `.env.migrate` with `umask 077`, and keeps `DATABASE_MIGRATE_URL` out of the app env (`docs/agents/working-rules.md`, Database roles; `AGENTS.md`, do not commit `.env`). Playwright still forces `NODE_ENV=test` and clears `RESEND_API_KEY` (`AGENTS.md`, tests never send real mail). No spec was removed or weakened. The working-rules e2e bullet matches the three-shard CI path.

**Judgement calls:**

- **Duplicated Code** — `.github/workflows/ci.yml`. The `e2e` job copies the `slow` Postgres service (image, Docker Hub credentials, `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, healthcheck). The same three values are hardcoded again in `.github/actions/ci-database/action.yml` (`POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=transferpro`). The action comment says the service must use those values; the copies can drift.
- **Duplicated Code** — shard width `3` is both the matrix and the command:

```176:176:.github/workflows/ci.yml
        shard: [1, 2, 3]
```

```255:255:.github/workflows/ci.yml
        run: pnpm exec playwright test --shard=${{ matrix.shard }}/3
```

The comment says the denominator must match the matrix. `working-rules.md` says CI does not drop a spec; a mismatch would. Not a breach as written.
- **Duplicated Code** (weak) — checkout, pnpm, `setup-node`, and `pnpm install --frozen-lockfile` are copied into `e2e-build`, `e2e`, and `e2e-report`. Same shape as `fast` and `slow`, so this follows the file rather than a new abstraction.

### Spec

`origin/develop` is `9cf384b4a7ecc8a8714810971f4b1b7552ccf83a`. The diff is non-empty (one commit, `a01606e`).

## (a) Missing or partial

**Item 3 and the after number are missing.** Spec: "Measure before/after and record the wall-clock time in the PR." And: "e2e wall-clock time on CI is clearly lower (target ~5 min), with numbers in the PR."

Before is only in `docs/handoff/284-shard-e2e.md` (slow job 13m 4s, e2e step 9m 16s, Playwright 8.7m, 206 tests on run 38927368815). The handoff says after is "Not measured" because this branch was not pushed. There is no PR, so neither figure is where the spec requires it, and the ~5 min target is unverified. The before run is also 206 tests, not the issue's "195 specs".

Sharding and the build cache are present: matrix `shard: [1, 2, 3]` with `--shard=${{ matrix.shard }}/3`, `fail-fast: false`, both Playwright projects kept, no spec files removed; `e2e-build` caches and uploads `.output`; shards download it and do not run `nuxi build`; `setup-node` uses `cache: pnpm`.

## (b) Scope creep

Spec scope is only the three items above. The diff also moves role minting, `.env` / `.env.migrate`, and `pnpm db:migrate:local` into `.github/actions/ci-database` and points the existing `slow` job (RLS and backup) at that action. That job's script is the same work as before, not a new suite.

## (c) Implemented, but wrong

No shard or cache step looks inverted. Playwright 1.63 names blob zips `report-1.zip`–`report-3.zip`, and `merge-multiple: true` will not collapse them. `upload-artifact` stores `.output` relative to that directory, so the shard check `.output/server/index.mjs` matches the download path. `playwright.config.ts` already loads `.env` and `.env.migrate`, so the shard step does not need to source them.

The open hole is acceptance, not the shard wiring: without a CI run, "clearly lower (target ~5 min)" is not shown.
