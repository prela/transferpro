# Local deltas from mattpocock/skills v1.3.1

Upstream is mattpocock/skills v1.3.1. A future vendor update must re-apply the deltas below. Never overwrite these files blindly.

## `.agents/skills/implement/SKILL.md`

- (a) #105 branch-create paragraph for local agents. A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.
- (b) Mandatory `docs/handoff/<N>-<slug>.md` step after `/code-review` (this chore). One-line out-of-scope, `## Decisions` (only what the next agent must follow), and `## Code review` with Standards and Spec pasted verbatim (judgement calls and Spec a/b/c). No PR without that file. Delete it on merge.
- (c) PR body must strip Cursor footer / `CURSOR_AGENT_PR_BODY_*` / Open-in-Web|Cursor image links; body is Why / What (+ `Closes #N` / ASVS when required).
- (d) Both `/code-review` subagents always start with `fast=false`. A mid-run steer that changes `fast` is forbidden (it spawns a second pair while the first keeps running).

## Lead: code-review subagents

Damir + NEO, 10.10.2026. Both code-review subagents run with `fast=false`. Set that at implement launch, or in `.agents/skills/implement/SKILL.md` before the run starts.

Leave a running implement's review model and `fast` as they were at launch. A steer that changes either one spawns a second pair of review subagents while the first pair keeps running. That steer is forbidden.

This rule now lives in `.agents/skills/implement/SKILL.md`, not only in this file.

## Not this workflow

The Pocock `handoff` skill writes to the OS temp directory. It is not part of this workflow. Lead QC uses only the repo file `docs/handoff/<N>-<slug>.md`.

## Update rule

Never wholesale-copy the Pocock skills folder. Update only untouched skills, then re-apply these deltas.
