# AGENTS.md

Rules for agents in this repo. This file is the source. `.cursor/rules/transferpro.mdc` only points here. Detail: `docs/agents/working-rules.md`.

## Where things are

- `CHARTER.md` — goal, scope, v1. Owner-locked.
- `GLOSSARY.md` — Transfer, Ride, Client, Partner, Tenant.
- `docs/adr/` — ADRs 0001–0019, including `0018-module-boundaries.md`. Do not contradict one; propose a new ADR.
- The ticket, then `docs/handoff/<issue>-<slug>.md` when present (`docs/handoff/README.md`).
- Skills in `.agents/skills/`. Issue tracker, labels, and domain: `docs/agents/`.

## Workflow

Start with `/implement #N`. Do not use subagents unless the ticket asks for them.

While working, run only the tests for changed files. At the end, run the full suite once: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:rls` when the slice touches tenant data. If the same failure happens twice, stop and report.

Commit and push to the ticket's `feature/*`, `fix/*`, or `chore/*` branch. Never open a PR. Never push to `develop`, `main`, or any other branch.

One slice per chat. Stop after the slice and `/code-review`.

Do not force-push, `git reset --hard`, `git branch -D`, or discard changes with `git checkout`, `git restore`, or `git stash`. Do not delete `node_modules` or `.modules.yaml`. Do not run `pnpm install` unless told. Do not print `.env` or `.env.migrate`.

Read the ticket comment headed `Owner decisions <d.m.>` before starting.

## Security

Every tenant table has `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy with `USING` and `WITH CHECK`, and `REVOKE ALL FROM PUBLIC`. No `DELETE` grant unless an ADR says so. The tenant id comes from the session, never the request. Every route and every loader or helper that returns tenant data enforces the role allow-list itself. Audit entries store field names and ids, never names, addresses, phone, or email.

## Migrations

One at a time. Apply locally with `pnpm db:migrate:local`. In `db/migrations/meta/_journal.json` the new `when` equals the previous `when` plus 1000. The values are synthetic; a smaller value is silently skipped.

## UI

Croatian and English copy. Light and dark mode.

Tests never send real mail. Use the fake or console mailer and leave RESEND unset.
Migrations, RLS, auth, and ride assignment run only on the strongest tier: Grok 4.7 high or stronger.

## Report

Handoff: commit SHA, branch, what changed, tests added or changed (never weaken or remove a test; flag any), migrations, decisions, open questions. Then `Context summarized: yes/no`. The last line is `REVIEW_READY`.

## Git text and the shell guard

Commit messages, PR titles, and PR bodies do not name models or contain a `Model:` line. PR bodies do not contain an agent footer or an agent-run link. `.husky/commit-msg` and `.github/workflows/agent-guard.yml` enforce that.

`.cursor/hooks.json` runs `.cursor/hooks/guard-shell.sh` on `beforeShellExecution`. A local agent may `git add`, `git commit`, and `git push` (including `git push -u origin <branch>`) only on `feature/*`, `fix/*`, and `chore/*`. The local hook denies a push to `develop`, `main`, or any other branch, a force push or `+refspec`, `git reset --hard`, `git branch -D`, a checkout, restore, or stash that discards changes, deleting a remote branch, deletion of `node_modules` or `.modules.yaml`, and reading `.env` files. A bare `git push` is judged by the upstream branch name when one is set. Project hooks run in cloud agents. `~/.cursor/hooks.json` does not, so a user stop hook does not clash. Cloud-agent git writes stay as they were, including `git branch -D`: `git commit` and `git push` are allowed when `/run/cursor/api.sock` is a unix socket, or when `CURSOR_AGENT_WORKER_ID` is set and the hook conversation id starts with `bc-`. Other denials stay. `CURSOR_AGENT` alone is not the cloud signal.
