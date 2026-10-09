# AGENTS.md

Rules for agents in this repo. This file is the source. `.cursor/rules/transferpro.mdc` only points here.

Read `docs/agents/working-rules.md` when the work touches database roles, migrations, the tenant session, audit, logging, provisioning, invitations, superadmin, tenant settings, UI, i18n, theme, or the shell guard.

## Read first

1. `CHARTER.md` — goal, scope, v1. Owner-locked. Never edit it: propose a diff, reason, and impact, then wait. Stay inside v1 scope. Non-goals in the Charter are out of bounds unless the ticket says so.
2. `GLOSSARY.md` — Transfer, Ride, Client, Partner, Tenant. Use those terms in code, tests, and tickets.
3. `docs/adr/` — ADRs 0001–0020, including `0018-module-boundaries.md`. Do not contradict one; propose a new ADR. When adding a module, follow ADR-0018. Update `GLOSSARY.md` or an ADR when a term or a decision changes.
4. The GitHub issue. Before starting, read every comment headed `Owner decisions <d.m.>`.
5. `docs/handoff/<issue>-<slug>.md` when that ticket has one. `docs/handoff/README.md` says when to delete it.

Skills live in `.agents/skills/`. Issue tracker, labels, and domain: `docs/agents/`.

## Workflow

Start with `/implement #N`. Use a subagent only when the ticket asks for one. One slice per chat. Stop after the slice and `/code-review`. Claim a work package only when its dependencies are merged. Blocked? Stop. Write what blocks you on the ticket; do not start another, and do not guess.

While working, run only the tests for changed files. At the end, run the full suite once: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:rls` when the slice touches tenant data. If the same failure happens twice, stop and report. Tests first: red before green for domain and application code. Coverage is 80% global and 95% for domain and application services. Never weaken or remove a test; flag any that you did. A UI change adds or extends a spec under `e2e/`. `pnpm test:rls` and `pnpm test:e2e` stay off the pre-commit hook.

Tests never send real mail. Use the fake or console mailer and leave `RESEND_API_KEY` unset. `pnpm dev` does not send through Resend unless `MAILER=resend` and `RESEND_API_KEY` are both set on purpose, because every Resend key on the account shares one daily quota.

Migrations, RLS, auth, and ride assignment run only on the strongest tier: Grok 4.7 high or stronger.

## Git

A local agent told a branch name, and not already on it, runs `git fetch origin` then `git switch -c <branch> origin/develop` before any edit. If that branch exists, stop and report; never switch to it. It may also `git switch -c <name>` or `git checkout -b <name>`, with an optional start of exactly `develop` or `origin/develop` and no other flags. `git checkout -B` and `git switch -C` stay denied.

`git add`, `git commit`, and `git push` (including `git push -u origin <branch>`) run only on the ticket's `feature/*`, `fix/*`, or `chore/*` branch. Never open a PR. Never commit to `develop` or `main`. Never push to `develop`, `main`, or any other branch. A bare `git push` uses the upstream name when one is set, otherwise the current branch. Conventional Commits. Do not hand-edit `CHANGELOG.md`; it is generated.

Denied for a local agent, and still denied for a cloud agent unless the cloud paragraph says otherwise: a force push, `--force-with-lease`, a `+refspec`, deleting a remote branch (`--delete` or `:name`), `git reset` (including `--hard`), `git branch -D`, `git stash`, `git restore`, and a `checkout`, `restore`, or `stash` that discards changes. Plain `checkout` or `switch` of an existing branch or of files stays denied, including for a cloud agent.

On `git add`, `git commit`, `git push`, or a branch create: no `--no-verify` or `-n`, no `git -c` or `--config-env`, no `GIT_CONFIG_*`, and no `git config` writes. `git config --get` and `git config --list` stay allowed. Do not delete `node_modules` or `.modules.yaml`. No `pnpm install` or `pnpm i` unless told. No `CI=1 pnpm`. No global installs; use repo scripts only.

Do not print or commit `.env` or `.env.migrate`. `printenv` and a bare `env` dump are denied; `env pnpm test` is allowed. `cat`, `less`, `more`, `head`, `tail`, and `grep` may not read `.env` except `.env.example`. The read hook denies `.env` and `.env.*` except names ending in `.example`, plus `*.pem`, `*.key`, and anything under `~/.ssh`.

`.husky/pre-commit` refuses a commit on `develop` or `main` unless `ALLOW_PROTECTED_BRANCH=1`. Commit messages, PR titles, and PR bodies do not name models or contain a `Model:` line. PR bodies do not contain an agent footer or an agent-run link. `.husky/commit-msg` and `.github/workflows/agent-guard.yml` enforce that. A pull request names the work package, what changed, what it could break, and any migration notes.

`.cursor/hooks.json` runs `.cursor/hooks/guard-shell.sh` on `beforeShellExecution` and `.cursor/hooks/guard-read.sh` on `beforeReadFile`. The guard fails closed.

Cloud-agent git writes stay as they were, including `git branch -D`. `git commit` and `git push` are allowed when `/run/cursor/api.sock` is a unix socket, or when `CURSOR_AGENT_WORKER_ID` is set and the hook conversation id starts with `bc-`. The same gate allows `git checkout -b <name>` and `git switch -c <name>`, including a start-point after the name. Other denials stay. A cloud agent is not subject to the local refusals of `--no-verify`, `git -c`, `GIT_CONFIG_*`, `git config` writes, `CI=1 pnpm`, and `pnpm install`. `CURSOR_AGENT` alone is not the cloud signal, and the worker id alone is not enough. `CURSOR_AGENT_SOCKET` is ignored. `CURSOR_CODE_REMOTE` means a remote workspace, not a cloud agent. Project hooks run in cloud agents. `~/.cursor/hooks.json` does not, so a user stop hook does not clash.

## Security

Every tenant table has `tenant_id`, `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy with `USING` and `WITH CHECK`, and `REVOKE ALL FROM PUBLIC`. No `DELETE` grant unless an ADR says so. The tenant id comes from the session, never the request. Every route and every loader or helper that returns tenant data enforces the role allow-list itself; do not rely on the caller. A test proves Tenant A cannot read or write Tenant B's rows. No exceptions without an ADR.

No production access. Never connect to, deploy to, or read secrets of production. No destructive DB operations (drop, truncate, mass delete/update, destructive migrations). Every migration goes in the PR for owner review; never apply it outside local or test databases.

Zod at every runtime boundary (env, request bodies, query params, imported bookings).

Audit entries store field names and ids, never names, addresses, phone, or email. Logs follow the same ban. Redaction rules are under Logging in `docs/agents/working-rules.md`.

No deep imports across modules or tiers. Import only from a module's `index.ts`. Domain and application never import Drizzle, Better Auth, Nuxt, or the queue directly; they use ports.

## Report

Handoff: commit SHA, branch, what changed, tests added or changed (never weaken or remove a test; flag any), migrations, decisions, open questions. Then `Context summarized: yes/no`. The last line is `REVIEW_READY`.
