# 495 Ship wrapper

Out of scope: signed local e2e proofs and moving the repo to private. Revisit after v1.

## Decisions

- `/implement` matches the mattpocock/skills default branch as of 24.10.2026 (`6d6a5b9`), which is after tag v1.3.1. The ticket-fetch paragraph and the Skill-tool wording are upstream. The local additions were the branch rule, `fast=false` on both code-review subagents, and the `READY_FOR_QC` report. Those now live in `/ship`, which then follows `/conclude`.
- A push and a pull request run only from `/conclude`, after its checks (including the full `pnpm test:e2e`) and the handoff commit.
- `pr-text` rejects an empty body, a body without `Closes #N`, and an OWASP ASVS checklist that is missing or has an unchecked item. The `implement` entry in `skills-lock.json` is the folder hash of the restored skill.
- After the standards review, the push lines name `/conclude`'s checks and the handoff commit. They no longer name only `pnpm test:e2e`.
- First conclude: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (995) passed. The first `pnpm test:e2e` looked for Chromium under the sandbox browser cache. The rerun passed (349, 5.4m) on `transferpro_e2e`. No migration.
- `a973a7f` puts the report after `/conclude`. The intro is "Ship one ticket: implement, then conclude." The branch is always `<type>/<issue>-<slug>` from `origin/develop`. "Context summarized" is gone. The report's last line is `READY_FOR_QC`. When `/ship` calls `/conclude`, `/conclude` does not write `REVIEW_READY`.
- After that review, `AGENTS.md` Git states the same branch create, so it no longer describes only "told a branch name."
- Second conclude: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (995) passed. `pnpm test:e2e` passed (349, 6.8m) on `transferpro_e2e` with `PLAYWRIGHT_BROWSERS_PATH` set to the installed browsers. No migration.
- Delete this file when the pull request merges.

## Code review

Fixed point `origin/develop` (`0ece6dc`). Both subagents started with `fast=false`. The reports below are the follow-up review, before the push-line wording named the whole conclude check instead of only e2e.

## Standards

### Hard

**Single source of truth** (`writing-for-agents/SKILL.md`, Pruning). One procedure still has several copies.

- Branch create is the same sentence in `AGENTS.md` Git, `.agents/LOCAL.md` (ship), and `.agents/skills/ship/SKILL.md` step 1, including "never switch to it."
- The QC report list and `READY_FOR_QC` are in `AGENTS.md` Report and ship step 3. Workflow and Report both say `/ship` then follows `/conclude`.
- `LOCAL.md`'s conclude entry says "See the skill." The ship bullets still inline branch create, the report, and the push.

**Lossy cache of the push gate** (same Pruning rule: a restatement is a cache). `AGENTS.md`: "That push waits until `/conclude` has run the full `pnpm test:e2e`." Ship step 4: "after the full `pnpm test:e2e`." `LOCAL.md`: "runs the full `pnpm test:e2e` and then pushes." `conclude` step a is five commands (`nuxi build`, lint, typecheck, test, whole `pnpm test:e2e`); step c pushes the commits from a and b. The new lines name only e2e.

**Progressive disclosure / environment as source** (`writing-for-agents/SKILL.md`, The two loads, Information hierarchy, Pruning). `AGENTS.md` always loads "`pr-text` also rejects an empty body, a body without `Closes #N`, and a body whose OWASP ASVS checklist is missing or unchecked." The same rule is in `LOCAL.md` (pr), `pr/SKILL.md`, and `conclude` step d. `check-pr-text.mjs` is the check.

The `fast=false` ship bullet now says "see Lead below." That copy inside `LOCAL.md` is gone.

### Judgement

**Negation** (Leading words). The new `AGENTS.md` `pr-text` sentence steers by rejection. The positive ("Add `Closes #N`", mark every item) is in `pr/SKILL.md`.

**Duplicated Code.** `ASVS_ITEMS` in `check-pr-text.mjs` ("copied from `.github/pull_request_template.md`") and `ASVS_CHECKED` in `agent-text.checks.mjs`. A heading change is shotgun surgery across the template, the hook, and the fixture.

**Divergent Change.** `AGENTS.md` changes the workflow entry, the `pr-text` cache, and the push gate in one always-loaded file.

**Residual overlap.** Ship step 2 still says set `fast=false` and leave the review model. Lead states that plus the reason a mid-run steer is forbidden.

Ship reading user-invoked `implement` and `conclude` matches `SKILL-MECHANICS.md`. Middle Man is overridden by `LOCAL.md`: the wrapper is the local skill.

## Spec

### (a) Missing or partial

Closed. Nothing left.

> Keep the full e2e suite as the local gate before every push, and make the agent workflow end in `/conclude` automatically.

> `/conclude` keeps running the full `test:e2e` locally. Nothing is pushed or opened as a PR outside `/conclude`.

`/ship` step 1 stops and never switches to an existing branch. Step 2 is done only when the commit is on the branch and the branch has not been pushed. Step 4 puts the push and the pull request in `/conclude`, after the full `pnpm test:e2e`. `AGENTS.md` Git allows `git push` only from `/conclude`, on the ticket branch, and that push waits until `/conclude` has run the full `pnpm test:e2e`. The old “Before push, run `pnpm lint && pnpm typecheck && pnpm test`” sentence is gone. `.agents/LOCAL.md` points `fast=false` at Lead, and keeps the branch unpushed until conclude runs e2e, then pushes and opens the pull request. `/conclude` still runs the whole `pnpm test:e2e` before its push.

### (b) Scope creep

None. The new sentences are the push and e2e gate from those two lines.

### (c) Implemented but wrong

None. `/implement` still matches the quoted upstream text. `/ship` still sets `fast=false` on both code-review prompts and reports `READY_FOR_QC` before `/conclude`. `pr-text` still fails an empty body, a missing `Closes #N`, and a missing or unchecked ASVS checklist. `AGENTS.md` still starts at `/ship #N`.

## Code review of a973a7f

Fixed point `84a546f`. Both subagents started with `fast=false`. The reports below are of that commit, before the Git sentence above.

## Standards

### (a) Documented standards

**Hard — single source of truth** (`writing-for-agents/SKILL.md`, Pruning; Context pointers, “Cut identity the body already carries”).

Branch create now disagrees. `AGENTS.md` Git is unchanged: a local agent told a name, and not already on it, runs `git switch -c <branch> origin/develop`; if it exists, “stop and report; never switch to it.” `ship/SKILL.md` step 1 always runs `git switch -c <type>/<issue>-<slug> origin/develop`, drops “never switch” and the already-on-it case, and is done only “on the new branch.” `.agents/LOCAL.md` keeps the slug and “stop and report.”

The QC report list is copied three times: ship step 4 (“handoff path”), `AGENTS.md` Report (“the handoff”), and `LOCAL.md` (“the handoff”). One reorder was a three-file edit.

**Judgement — negation** (Leading words). `LOCAL.md`: “When `/ship` called conclude, conclude does not write `REVIEW_READY`.” `conclude/SKILL.md` step e already states the positive: “return to it for the report. Otherwise the last line is `REVIEW_READY`.”

**Judgement — completion criterion** (Steps and completion criteria). Step e has no “Done when.” “When `/ship` called this skill” does not say how the agent tells.

**Judgement — pointer** (Context pointers). Conclude step d, “Write the body with .agents/skills/pr/SKILL.md,” never says to read that file, then recopies the `pr-text` rejection list the skill and `check-pr-text.mjs` already hold.

**Judgement — hierarchy** (Information hierarchy). Ship step 2 dropped “Leave `fast` and the review model as they were at launch.” That guard remains only in `LOCAL.md` Lead. The skill does not point there. `fast=false` itself stays in the step.

### (b) Smells (judgement)

**Duplicated Code.** Same report:
- ship: “State the commit SHA, the branch, what changed, tests added or changed … the handoff path, and the pull request link. The last line is `READY_FOR_QC`.”
- `AGENTS.md`: “`/ship` reports, after `/conclude`, the commit SHA, branch, what changed … the handoff, and the pull request link.”
- `LOCAL.md`: “the report lists the commit SHA, the branch, what changed, tests, migrations, decisions, open questions, the handoff, and the pull request link.”

**Shotgun Surgery.** That order change is why `AGENTS.md`, `LOCAL.md`, `ship/SKILL.md`, and `conclude/SKILL.md` all move.

**Mysterious Name.** “`<type>/<issue>-<slug>`” does not tie `<type>` to the `feature/*`, `fix/*`, `chore/*` names in `AGENTS.md` Git.

Middle Man suppressed: `LOCAL.md` defines the wrapper as the local skill.

## Spec

### (a) Missing or partial

One partial. Spec (1): "branch step: always a new branch `<type>/<issue>-<slug>` from origin/develop, if it exists stop and report."

`ship/SKILL.md` step 1 does that (`git fetch origin`, then `git switch -c <type>/<issue>-<slug> origin/develop`; if it exists, stop and report). `AGENTS.md` Workflow states the same create. `AGENTS.md` Git, in the same always-loaded file, still says a local agent creates a branch only when "told a branch name, and not already on it," and the name is `<branch>`, not `<type>/<issue>-<slug>`. That is the old trigger.

The rest of the named text matches:

- Intro is "Ship one ticket: implement, then conclude."
- "Leave `fast`…" is gone from `/ship`. `LOCAL.md` Lead still has "Leave a running ship's review model and `fast` as they were at launch."
- Order is branch, implement (`fast=false` in both code-review prompts), conclude, then the report.
- "Context summarized" is gone. The report lists SHA, branch, changes, tests, migrations, decisions, open questions, handoff, and the PR link. Its last line is `READY_FOR_QC`.
- Conclude step e writes `REVIEW_READY` only when `/ship` did not call it.
- Spec (3): conclude step d says "Write the body with .agents/skills/pr/SKILL.md".

### (b) Not asked for

None. The `LOCAL.md` ship bullets were rewritten to the same branch rule, order, and "no `REVIEW_READY` when `/ship` called conclude" line, so the local delta matches the skill.

### (c) Implemented but wrong

None in the named files.
