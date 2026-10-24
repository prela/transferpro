---
name: conclude
description: "Close the last commit: fresh checks, handoff, push, and a pull request."
disable-model-invocation: true
---

Conclude the last commit on the current branch.

Any change to code or tests sends you back to step a before a later step. Commit that change on the current branch only after step a is green.

a. Run a fresh `pnpm exec nuxi build`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the whole `pnpm test:e2e`. Run every e2e spec. Done when all five finish green.

b. Write or update `docs/handoff/<issue>-<slug>.md`: a one-line out-of-scope note, `## Decisions`, and `## Code review` with Standards and Spec pasted verbatim from the review. Commit the handoff. A docs-only handoff commit does not return to step a. Done when the file is on the branch. Delete the file when the ticket merges. The pull request waits on that file.

c. Push the current branch. Done when the remote has the commits from a and b.

d. Open a pull request. The body follows `/pr`, includes `Closes #N`, fills the OWASP ASVS checklist from `.github/pull_request_template.md` with every item checked, and passes `pr-text` (non-empty body, `Closes #N`, completed checklist, no model name, no `Model:` line, no agent footer or agent-run link, no redacted name). Done when the pull request is open.

e. Report `REVIEW_READY` and the pull request link. The pull request stays open for review.
