# 495 Ship wrapper

Out of scope: signed local e2e proofs and moving the repo to private. Revisit after v1.

## Decisions

- `/implement` matches the mattpocock/skills default branch as of 24.10.2026 (`6d6a5b9`), which is after tag v1.3.1. The ticket-fetch paragraph and the Skill-tool wording are upstream. The local additions were the branch rule, `fast=false` on both code-review subagents, and the `READY_FOR_QC` report. Those now live in `/ship`, which then follows `/conclude`.
- A push and a pull request run only from `/conclude`, after its checks (including the full `pnpm test:e2e`) and the handoff commit.
- `pr-text` rejects an empty body, a body without `Closes #N`, and an OWASP ASVS checklist that is missing or has an unchecked item. The `implement` entry in `skills-lock.json` is the folder hash of the restored skill.
- After the standards review, the push lines name `/conclude`'s checks and the handoff commit. They no longer name only `pnpm test:e2e`.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (995) passed. The first `pnpm test:e2e` looked for Chromium under the sandbox browser cache. The rerun set `PLAYWRIGHT_BROWSERS_PATH` to the installed browsers and passed (349, 5.4m) on `transferpro_e2e`. No migration.
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
