---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

After `/code-review`, write or update `docs/handoff/<N>-<slug>.md`: one-line out-of-scope, `## Decisions` (only what the next agent must follow), and `## Code review` with Standards and Spec pasted verbatim (judgement calls and Spec a/b/c). No PR without that file. Delete it on merge.

When you open or update a PR, the body is only Why / What (plus `Closes #N` and ASVS when required). Strip every Cursor footer, `CURSOR_AGENT_PR_BODY_*` marker, and Open-in-Web / Open-in-Cursor image link before you mark it ready.

Commit your work to the current branch.
