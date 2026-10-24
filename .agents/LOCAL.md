# Local deltas from mattpocock/skills v1.3.1

Upstream for the pack is mattpocock/skills v1.3.1, except `implement`, which matches the upstream default branch as of 24.10.2026 (`6d6a5b9`, after that tag). A future vendor update must re-apply the deltas below. Never overwrite these files blindly. Replacing `implement` with upstream does not re-apply a delta: that file has none.

## `.agents/skills/implement/SKILL.md`

Matches upstream. The ticket-fetch paragraph and the Skill-tool wording are upstream, not local. A vendor update may replace this file with upstream.

## `.agents/skills/ship/SKILL.md`

Local skill, not upstream. User-invoked. It creates the branch, follows implement, follows conclude, then writes the report. A vendor update must not delete it.

- Branch create, before implement. The branch is `<type>/<issue>-<slug>` from `origin/develop`. If that branch already exists, stop and report.
- Both code-review subagents: see Lead below.
- After conclude: the report lists the commit SHA, the branch, what changed, tests, migrations, decisions, open questions, the handoff, and the pull request link. The last line is `READY_FOR_QC`. When `/ship` called conclude, conclude does not write `REVIEW_READY`.

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
