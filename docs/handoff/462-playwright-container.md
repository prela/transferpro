# 462 Playwright container for e2e

Out of scope: changing e2e specs, and editing `CHARTER.md` (tracked in #492).

## Decisions

- The `e2e` job runs in `mcr.microsoft.com/playwright:v1.63.0-noble`, the `@playwright/test` version in the lockfile. A step compares `/ms-playwright/.docker-info` with the installed package.
- Browser install, `install-deps`, and the browser cache are gone. `PLAYWRIGHT_BROWSERS_PATH` is `/ms-playwright`. The container runs as root with `--ipc=host`. Chromium's sandbox is off when the uid is 0.
- Inside the job container the default shell is `sh`, which rejects `set -o pipefail`. The job sets `defaults.run.shell` to bash (`50c5c1b`).
- Postgres is the service host `postgres`. The harness accepts `127.0.0.1` or that host, and still refuses every other host. The drop exception in `AGENTS.md` names the same host. `slow` still uses `127.0.0.1`.
- The database step installs `postgresql-client` when `psql` is missing. The Playwright image does not ship that client.
- `e2e-report` stays on the runner. It only merges blob reports.

## Before

Issue examples, install-deps on the runner:

- PR #461 `e328324` shard 3: 8:54 (job 16.5 min).
- develop `bcafd87` shards 1 and 3: 10:13 and 8:58.
- Test time 5.5–6.5 min per shard.

Run [40043376418](https://github.com/prela/transferpro/actions/runs/40043376418) on this branch failed before the suite: `set: Illegal option -o pipefail`. Shards ended in about a minute (`e2e (1)` 00:09:57Z–00:11:04Z, `e2e (2)` 00:09:58Z–00:11:32Z, `e2e (3)` 00:09:57Z–00:11:06Z).

## After

Local conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (995) passed, then `E2E_PORT=30284 PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` — 349 passed (7.1m). The CI shard times after the bash fix are the next run of this branch.

No migration. No spec added, removed, or weakened. `scripts/e2e-database.test.mjs` gained the CI host case.

## Code review

Fixed point `origin/develop`. The reports below are the review of the container commit before the bash fix.

### Standards

**Hard — `AGENTS.md` Security (drop exception) vs the new host.** `AGENTS.md` still says `pnpm test:e2e` may drop and recreate only the localhost database `transferpro_e2e`. `docs/agents/working-rules.md` says that file wins when they disagree. This commit updates the workflow sentence and the e2e bullet in working-rules to allow the CI host `postgres`, and `e2e/prepare-database.ts` drops on whatever host `assertE2eDatabaseEnv` accepted (`url.hostname = app.host`). The security sentence was not changed. The new comment claims “AGENTS.md allows this drop only for `transferpro_e2e` on localhost or the CI service host `postgres`,” which that paragraph does not say. `CHARTER.md` (Constraints) still forbids destructive database operations with no host exception; the only written carve-out remains the localhost sentence. No charter edit proposed.

**Judgement — Duplicated Code.** In `.github/actions/ci-database/action.yml` the root-versus-sudo `apt-get update` / install block is copied once for `psql` and again for `openssl`. The allow-list `127.0.0.1` or `postgres` is also written twice: the `case` in that action and `isE2eDatabaseHost` in `scripts/e2e-database.mjs`.

**Judgement — refusal copy, not a baseline smell.** `e2eDatabaseUrl` and `assertE2eDatabaseEnv` still throw “must be localhost” and “must target localhost” after the same change’s comments and the working-rules e2e bullet name `postgres` as allowed. The new test asserts `/localhost/` for a lookalike host, so the stale wording is locked in. The host check itself matches the allow-list; the rule does not prescribe the sentence.

No new module (`docs/adr/0018-module-boundaries.md` does not apply). Glossary terms are unused. No test was removed or weakened. Shotgun Surgery is suppressed: the e2e rule requires the working-rules and `AGENTS.md` updates. No Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Divergent Change, Speculative Generality, Message Chains, Middle Man, or Refused Bequest.

### Spec

#### (a) Missing or partial

- "No install-deps step; the e2e shards pass." `playwright install`, `install-deps`, and the browser-cache steps are gone from the `e2e` job. The commit is unpushed and contains no green shard run, so the pass half is unmet.
- "Before/after job times are noted in the PR." There is no pull request. The commit message does not record the issue's before times (PR #461 shard 3 at 8:54, job 16.5 min; develop shards at 10:13 and 8:58) or any after time.

#### (b) Scope creep

"Run the e2e jobs…" The shared `.github/actions/ci-database` action is also used by `slow`. That job still defaults to `127.0.0.1`, but it no longer always installs `postgresql-client`. It installs `psql` and `openssl` only when they are missing, and it rejects any host other than `127.0.0.1` or `postgres`. That surface is outside the e2e jobs.

The `postgres` allow-list in the e2e harness, plus the `AGENTS.md` and `docs/agents/working-rules.md` edits, is the service hostname the spec asks for.

#### (c) Implemented, but wrong

"OS packages are not cached" and "Remove the install-deps and browser-cache steps." Those steps are gone. The image `mcr.microsoft.com/playwright:v1.63.0-noble` matches `@playwright/test@1.63.0` in `pnpm-lock.yaml`, and a step checks `/ms-playwright/.docker-info` `driverVersion` against the installed package. The official noble image does not ship `postgresql-client` and deletes apt lists. Every shard's database step still runs a cold `apt-get update` and `apt-get install postgresql-client` as root. That is the same uncached apt-get path, on a smaller package. `docs/agents/working-rules.md` says the job "does not install browsers or system packages," which this step contradicts.

"The Postgres service and the DB steps must keep working inside the container (service hostname rather than localhost, if needed)." `postgres:5432` is passed through `ci-database`, the URL allow-list, and the prepare/server asserts. That matches GitHub job-container DNS (service label and container port).

Follow-up `700f4f7` updates the drop exception, the refusal text, and the working-rules line about `postgresql-client`. `50c5c1b` sets the e2e shell to bash.
