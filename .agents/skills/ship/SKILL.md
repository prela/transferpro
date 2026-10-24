---
name: ship
description: "Build one ticket with implement, then close it with conclude."
disable-model-invocation: true
---

Ship one ticket. The two procedures live in their own files. This skill adds the local steps and the order.

1. Branch. When this agent is local, was told a branch name, and is not already on it, run `git fetch origin`, then `git switch -c <branch> origin/develop`, before any edit. If that branch already exists, stop and report; never switch to it. Done when the worktree is on that branch, or it was already on it.

2. Implement. Read and follow `.agents/skills/implement/SKILL.md` from start to finish. When it says to call code-review, set `fast=false` in both subagent prompts before they start. Leave `fast` and the review model as they were at launch. Done when that skill's commit is on the current branch and the branch has not been pushed.

3. Report. State the commit SHA, the branch, what changed, tests added or changed (never weaken or remove a test; flag any), migrations, decisions, and open questions, then `Context summarized: yes/no`. The last line is `READY_FOR_QC`. Done when that line is the last line of the report.

4. Conclude. Read and follow `.agents/skills/conclude/SKILL.md`. The push and the pull request happen in this step, after that skill's checks and the handoff commit. Done when its last line is `REVIEW_READY` and the pull request link.
