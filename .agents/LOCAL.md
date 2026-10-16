# Local deltas from mattpocock/skills v1.3.1

Upstream is mattpocock/skills v1.3.1. A future vendor update must re-apply the deltas below. Never overwrite these files blindly.

## `.agents/skills/implement/SKILL.md`

- Branch create, at the start. A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.
- Both `/code-review` subagents always run with `fast=false`. A mid-run change of `fast` is forbidden.
- After the commit: do not push and do not open a pull request. Short report, then `READY_FOR_QC`.

## `.agents/skills/conclude/SKILL.md`

Local skill, not upstream. User-invoked. See the skill for the close-out steps. A vendor update must not delete it.

## `.agents/skills/pr/SKILL.md`

The body follows the template and passes `pr-text`. That job rejects a model name, a `Model:` line, an agent footer or agent-run link, and a redacted name. It does not require the OWASP ASVS checklist. The template still carries that checklist because the Charter does.

## Lead: code-review subagents

Damir + NEO, 10.10.2026. Both code-review subagents run with `fast=false`. The Task tool has no `fast` parameter; the prompts set `fast=false` before the run starts.

Leave a running implement's review model and `fast` as they were at launch. A steer that changes either one spawns a second pair of review subagents while the first pair keeps running. That steer is forbidden.

## Not this workflow

The Pocock `handoff` skill writes to the OS temp directory. It is not part of this workflow. Lead QC uses only the repo file `docs/handoff/<issue>-<slug>.md`.

## Update rule

Never wholesale-copy the Pocock skills folder. Update only untouched skills, then re-apply these deltas.
