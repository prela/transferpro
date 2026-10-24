---
name: ship
description: "Build one ticket with implement, then close it with conclude."
disable-model-invocation: true
---

Ship one ticket: implement, then conclude.

1. Branch. Create `<type>/<issue>-<slug>` from `origin/develop`. Run `git fetch origin`, then `git switch -c <type>/<issue>-<slug> origin/develop`, before any edit. If that branch already exists, stop and report. Done when the worktree is on the new branch.

2. Implement. Read and follow `.agents/skills/implement/SKILL.md` from start to finish. When it says to call code-review, set `fast=false` in both subagent prompts before they start. Done when that skill's commit is on the current branch and the branch has not been pushed.

3. Conclude. Read and follow `.agents/skills/conclude/SKILL.md` through the open pull request. Done when the pull request is open.

4. Report. State the commit SHA, the branch, what changed, tests added or changed (never weaken or remove a test; flag any), migrations, decisions, open questions, the handoff path, and the pull request link. The last line is `READY_FOR_QC`. Done when that line is the last line of the report.
