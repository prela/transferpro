---
name: conclude
description: "Close the last commit: fresh checks, push, a pull request, and a QC comment."
disable-model-invocation: true
---

Conclude the last commit on the current branch.

Any change to code or tests sends you back to step a before a later step. Commit that change on the current branch only after step a is green.

a. Run a fresh `pnpm exec nuxi build`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the whole `pnpm test:e2e`. Run every e2e spec. Done when all five finish green.

b. Push the current branch. Done when the remote has the commits from a.

c. Open a pull request. Write the body with .agents/skills/pr/SKILL.md. It includes `Closes #N`, fills the OWASP ASVS checklist from `.github/pull_request_template.md` with every item checked, and passes `pr-text` (non-empty body, `Closes #N`, completed checklist, no model name, no `Model:` line, no agent footer or agent-run link, no redacted name). `pr-text` checks the title and the body only.

Add one comment on that pull request, at most 8 lines. Start with these labels, in this order. A label may continue on the next line when it names more than one deviation or finding.

```text
Deviations: <how this differs from the issue, each with a reason, or None>
Unresolved review findings: <from the latest review, or None>
Local checks: build <pass|fail>; lint <pass|fail>; typecheck <pass|fail>; test <count> <pass|fail>; e2e <count> <pass|fail> on <database>
Open questions: <or None>
```

Write the comment as plain text. Leave out client names, company names, amounts, keys, and tool markers. Done when the pull request is open and that comment is on it.

d. The pull request stays open for review. When `/ship` called this skill, return to it for the report. Otherwise the last line is `REVIEW_READY` and the pull request link.
