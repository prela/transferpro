# Implement and conclude

Out of scope: there is no GitHub issue for this chore, so the pull request does not close one.

Fixed point `origin/develop` (`f4e8a79`). The reports below are the review of the working tree before `b46dd65`. Both subagents started with `fast=false`.

## Decisions

- `/implement` is the upstream skill plus three insertions: the branch rule at the start, `fast=false` beside code review, and a stop after the commit (`READY_FOR_QC`, no push, no pull request).
- `/conclude` owns the fresh build, lint, typecheck, unit tests, and the whole e2e suite, then the handoff, the push, and the pull request.
- `pr-text` rejects a model name, a `Model:` line, an agent footer or agent-run link, and a redacted name. It does not require the OWASP ASVS checklist. The Charter still does, so `/pr` carries that checklist.
- A pull request is opened only from `/conclude`.
- Delete this file when the pull request merges.

## Code review

### Standards

### Hard

**`AGENTS.md`** — Git still says `Never open a PR` (unchanged). The Workflow hunk and `/conclude` open one. One source file, two instructions.

**`.agents/skills/implement/SKILL.md`** — `writing-for-agents` (Steps): every step ends on a completion criterion. The rewrite has none except the last line. Unbounded: “Implement the work described by the user…”, the new ticket-fetch step, “Call the Skill tool with `tdd`…”, the test sentence, code-review, and “Commit your work…”.

**`.agents/skills/pr/SKILL.md`** — `writing-for-agents` (Pruning): a restatement of the environment is a cache; one meaning, one place. The new paragraph copies what `pr-text` rejects (model name, `Model:` line, agent footer, redacted name), already in `AGENTS.md` Git and in the hooks it cites. The Charter-versus-`pr-text` sentence is the part that earns a cache. Inside the body fence, “`pr-text` does not read this section. The Charter does.” repeats that note into the artifact. Summary instructions sit outside the fence; this one does not (co-location).

**`fast=false`** — same Pruning rule. One meaning in three hunks: `implement/SKILL.md` (“Both subagents always run with `fast=false`…”), `.agents/LOCAL.md` implement bullet, and `.agents/LOCAL.md` Lead (“The prompts set `fast=false` before the run starts.”).

**`AGENTS.md` Workflow and Report** — `writing-for-agents` (Context pointers): cut identity the body already carries. Always-loaded lines restate `/implement`’s `READY_FOR_QC` and `/conclude`’s checks, handoff, push, PR, and `REVIEW_READY`, which the two skills already state.

`.agents/LOCAL.md` may keep a short delta: its header says a vendor update must re-apply these. That does not justify a second `fast=false` inside the same file.

### Judgement

**Negation** (`writing-for-agents`): `implement` “Do not push and do not open a pull request” is paired with `READY_FOR_QC`, so it can stand as a guardrail. In `conclude/SKILL.md`, “There is no pull request without that file” and “Leave the pull request unmerged” repeat bounds already stated positively (“Done when the file is on the branch”, “Done when the pull request is open”).

**Mysterious Name:** `conclude` and `LOCAL.md` use `docs/handoff/<N>-<slug>.md`; `AGENTS.md` uses `<issue>-<slug>`.

`conclude/agents/openai.yaml` matches the user-invoked `implement` shape. No finding. Hook-enforced `pr-text` rules are skipped as tooling.

### Spec

### (a) Missing or partial

None. The three allowed insertions are in `.agents/skills/implement/SKILL.md`. `.agents/skills/conclude/SKILL.md` has implement-style frontmatter, `disable-model-invocation: true`, and `agents/openai.yaml` in the same shape as implement. Steps a–e cover the fresh build, lint, typecheck, test, the whole `pnpm test:e2e`, the handoff file, push, a `/pr` body with `Closes #N`, no merge, and `REVIEW_READY` plus the PR link. `/pr` records that `pr-text` rejects a model name, a `Model:` line, an agent footer, and a redacted name, and that it does not require ASVS, while the template still carries the Charter checklist.

### (b) Not asked for

- `.agents/skills/implement/SKILL.md` adds, after the allowed fast rule: "it spawns a second pair of review subagents while the first pair keeps running." Spec: "plus only: … next to code-review: both subagents always `fast=false`, a mid-run change of `fast` is forbidden."
- `AGENTS.md` workflow and Report sections are rewritten (READY_FOR_QC vs REVIEW_READY). The spec names only implement, conclude, and `/pr`.
- `.agents/LOCAL.md` is rewritten, including "The Task tool has no `fast` parameter."

### (c) Implemented, but wrong

- `AGENTS.md` still says "Stop after the slice and `/code-review`" in the same paragraph that says `/implement` commits and ends `READY_FOR_QC`. Spec: "at the end, after the commit: do not push and do not open a PR; give a short report and `READY_FOR_QC`."

### After this review

`b46dd65` addresses the hard Git contradiction, the Spec (b) extra sentence on `fast`, the Spec (c) “stop after code review” line, and the `<N>` versus `<issue>` name. The upstream implement sentences stay without added completion criteria, because the spec requires them word for word. The `pr-text` list stays in `/pr`, because that is the alignment the spec asked for.
