# AGENTS.md

Rules for agents in this repo. This file is the source. `.cursor/rules/transferpro.mdc` only points here. Detail: `docs/agents/working-rules.md`.

## Where things are

- `CHARTER.md` — goal, scope, v1. Owner-locked.
- `GLOSSARY.md` — Transfer, Ride, Client, Partner, Tenant.
- `docs/adr/` — ADRs 0001–0019, including `0018-module-boundaries.md`. Do not contradict one; propose a new ADR.
- The ticket, then `docs/handoff/<issue>-<slug>.md` when present (`docs/handoff/README.md`).
- Skills in `.agents/skills/`. A slice uses `tp-implement`. Issue tracker, labels, and domain: `docs/agents/`.

## Workflow

One slice per chat. Stop after the slice and `/code-review`. The human commits: do not `git commit`, `git push`, `git reset`, `git checkout`, or `git stash` (`git switch` and `git restore` too). Do not delete `node_modules` or `.modules.yaml`. Do not run `pnpm install` unless told. Do not print `.env` or `.env.migrate`.

Read the ticket comment headed `Owner decisions <d.m.>` before starting.

## Security

Every tenant table has `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy with `USING` and `WITH CHECK`, and `REVOKE ALL FROM PUBLIC`. No `DELETE` grant unless an ADR says so. The tenant id comes from the session, never the request. Every route and every loader or helper that returns tenant data enforces the role allow-list itself. Audit entries store field names and ids, never names, addresses, phone, or email.

## Migrations

One at a time. Apply locally with `pnpm db:migrate:local`. In `db/migrations/meta/_journal.json` the new `when` equals the previous `when` plus 1000. The values are synthetic; a smaller value is silently skipped.

## UI

Croatian and English copy. Light and dark mode.

## Report

What changed, tests added or changed (never weaken or remove a test; flag any), migrations, open questions. Then `Context summarized: yes/no`. The last line is `REVIEW_READY`.

## Git text and the shell guard

Commit messages, PR titles, and PR bodies do not name models or contain a `Model:` line. PR bodies do not contain an agent footer or an agent-run link. `.husky/commit-msg` and `.github/workflows/agent-guard.yml` enforce that.

`.cursor/hooks.json` runs `.cursor/hooks/guard-shell.sh` on `beforeShellExecution`. It denies the git commands above, deletion of `node_modules` or `.modules.yaml`, and reading `.env` files. Project hooks run in cloud agents. `~/.cursor/hooks.json` does not, so a user stop hook does not clash. `git commit` and `git push` are allowed on a managed cloud VM (metadata socket) or a self-hosted worker (`CURSOR_AGENT_WORKER_ID`), and when `TP_ALLOW_GIT=1`. Other denials stay. `CURSOR_AGENT` alone is not the cloud signal.
