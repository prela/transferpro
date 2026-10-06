---
name: tp-implement
description: Implement one transferpro ticket slice and stop for the human to commit. Use when implementing a ticket, a WP, a GitHub issue, or one slice of one.
---

# tp-implement

Implement one slice. The rules are `AGENTS.md`. This file is only the sequence. Longer notes are `docs/agents/working-rules.md`.

## Steps

1. Read the ticket, every comment headed `Owner decisions <d.m.>`, the ADRs the slice touches (`docs/adr/`, including `0018-module-boundaries.md` when adding a module), and the matching sections of `docs/agents/working-rules.md`.
   Done when the plan names those sources.

2. Plan one slice: files, tests, and at most one migration. Tests for domain and application code go red first.
   Done when the plan lists each new or changed test and the migration, if any.

3. Implement that plan. Keep every existing test. A weakened or removed test is called out in the report.
   Done when the new tests failed for the missing behaviour and then passed.

4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:rls` when the slice touches tenant data. Run `pnpm test:agent-guard` when the slice touches the shell guard or the commit-message check. Those checks are `node:test` files named `.checks.mjs` so ESLint does not rewrite them to vitest.
   Done when each required command exits 0.

5. Run `/code-review` against the merge-base with `develop`. Fix findings that are in the slice.
   Done when no in-scope finding is still open, or each leftover is an open question in the report.

6. Leave the tree uncommitted. Do not `git commit`, `git push`, `git reset`, `git checkout`, `git stash`, `git switch`, or `git restore`. Write the report from `AGENTS.md`.
   Done when the report states what changed, tests added or changed, migrations, and open questions, then a line `Context summarized: yes/no`, and the last line is `REVIEW_READY`.
