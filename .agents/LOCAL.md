# Local deltas from mattpocock/skills v1.3.1

Upstream for the pack is mattpocock/skills v1.3.1, except `implement`, which matches the upstream default branch as of 24.10.2026 (`6d6a5b9`, after that tag). A future vendor update must re-apply the deltas below. Never overwrite these files blindly. Replacing `implement` with upstream does not re-apply a delta: that file has none.

## `.agents/skills/implement/SKILL.md`

Matches upstream. The ticket-fetch paragraph and the Skill-tool wording are upstream, not local. A vendor update may replace this file with upstream.

## `.agents/skills/ship/SKILL.md`

Local skill, not upstream. User-invoked. It follows implement, then the local steps, then conclude. A vendor update must not delete it.

- Branch create, before implement. A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.
- Both code-review subagents: see Lead below.
- After the implement commit: the short report, last line `READY_FOR_QC`. The branch stays unpushed until conclude finishes its checks and the handoff, then pushes and opens the pull request.

## `.agents/skills/conclude/SKILL.md`

Local skill, not upstream. User-invoked. See the skill for the close-out steps. A vendor update must not delete it.

## `.agents/skills/pr/SKILL.md`

The body follows the template and passes `pr-text`. That job rejects an empty body, a missing `Closes #N`, a missing or unchecked OWASP ASVS checklist, a model name, a `Model:` line, an agent footer or agent-run link, and a redacted name.

## Lead: code-review subagents

Damir + NEO, 10.10.2026. Both code-review subagents run with `fast=false`. The Task tool has no `fast` parameter; the prompts set `fast=false` before the run starts.

Leave a running ship's review model and `fast` as they were at launch. A steer that changes either one spawns a second pair of review subagents while the first pair keeps running. That steer is forbidden.

## Not this workflow

The Pocock `handoff` skill writes to the OS temp directory. It is not part of this workflow. Lead QC uses only the repo file `docs/handoff/<issue>-<slug>.md`.

## Update rule

Never wholesale-copy the Pocock skills folder. Update only untouched skills, then re-apply these deltas.
