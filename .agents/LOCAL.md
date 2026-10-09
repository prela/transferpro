# Local deltas from mattpocock/skills v1.3.1

Upstream is mattpocock/skills v1.3.1. A future vendor update must re-apply the deltas below. Never overwrite these files blindly.

## `.agents/skills/implement/SKILL.md`

- (a) #105 branch-create paragraph for local agents. A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.
- (b) Mandatory `docs/handoff/<N>-<slug>.md` step after `/code-review` (this chore). One-line out-of-scope, `## Decisions` (only what the next agent must follow), and `## Code review` with Standards and Spec pasted verbatim (judgement calls and Spec a/b/c). No PR without that file. Delete it on merge.

## Not this workflow

The Pocock `handoff` skill writes to the OS temp directory. It is not part of this workflow. Lead QC uses only the repo file `docs/handoff/<N>-<slug>.md`.

## Update rule

Never wholesale-copy the Pocock skills folder. Update only untouched skills, then re-apply these deltas.
