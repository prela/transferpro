# 312 Preview requires MAIL_ALLOWLIST

Out of scope: who receives mail after boot. That stays the ADR-0042 allowlist on the mailer.

## Decisions

- `DEPLOY_ENV` is `preview`, `production`, or unset. Blank is unset. Zod parses it on `parseAppEnv`. Any other value throws `DEPLOY_ENV must be preview, production, or unset.` and the message does not include the value.
- `DEPLOY_ENV=preview` throws `MAIL_ALLOWLIST is required when DEPLOY_ENV is preview.` when the list is unset or blank. Unset and `production` still boot without the list. The ADR-0037 console flag is unchanged.
- `NODE_ENV` stays `production` for preview and production. Preview without `MAILER=resend` still fails the production resend rule.
- ADR-0043 is accepted. It records the boot rule. ADR-0042 still covers who is sent.

## Tests

No test removed or weakened. `server/core/app-env.test.ts` splits the boot cases. No migration.

`origin/develop` was merged (`6d8a721`, #311). Then `pnpm lint`, `pnpm typecheck`, and `pnpm test` (613) passed. End-to-end was not run.

## Code review

Fixed point `origin/develop`. The reports below are the review of `41edd6a`, before QC split the tests and accepted ADR-0043.

### Standards

**Hard.** `AGENTS.md` (Read first): do not contradict an ADR; propose a new one, and update an ADR when a decision changes. `docs/adr/README.md` (Format): an accepted ADR is not edited; it is superseded.

The first commit cited ADR-0042 for a boot rule that ADR does not contain. Follow-up `41edd6a` adds proposed ADR-0043 and points the docs at that proposal. ADR-0042 and ADR-0037 were not edited.

`server/core/index.ts` matches the updated working rules (Zod at the env boundary, fixed error text, value not echoed). No other documented breach.

**Judgement — Speculative Generality.** `DEPLOY_ENV` is stored on `AppEnv`, and nothing outside `parseAppEnv` and the test reads it. Weak: every other parsed setting on this type is exposed the same way.

### Spec

(a) None. The diff covers every acceptance line.

- `DEPLOY_ENV` is `preview`, `production`, or unset: `parseDeployEnv` uses `z.enum(['preview', 'production'])` inside `parseAppEnv`, `blankEnv` turns `''` into unset, and any other value throws `DEPLOY_ENV must be preview, production, or unset.` The test checks that message does not contain the raw value.
- `DEPLOY_ENV=preview` with `MAIL_ALLOWLIST` missing or `''` throws `MAIL_ALLOWLIST is required when DEPLOY_ENV is preview.` `boot` calls `loadAppEnv`, which calls `parseAppEnv`.
- Unset and `production` still return with the list undefined. The ADR-0037 path (`ALLOW_CONSOLE_MAILER === '1'` and `MAILER=console`) is unchanged; the new test still boots that case with the list unset.
- `NODE_ENV` parsing is untouched. Preview cases in the test keep `NODE_ENV=production`, and preview without `MAILER=resend` still fails that existing production rule. `docs/ops/preview.md` states the same.
- `docs/ops/preview.md` and `.env.example` name `DEPLOY_ENV=preview` beside `MAIL_ALLOWLIST`, and both say production leaves `DEPLOY_ENV` unset or sets `production`.
- The new case is in `server/core/app-env.test.ts` and does not touch the network.

(b) None. `docs/agents/working-rules.md` only restates this rule in the invitation paragraph that already described preview mail.

(c) None. The preview check runs after the existing allowlist parse, so a blank list is unset and a bad address still fails with the #306 message.
