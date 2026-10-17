# 308 Change password

Out of scope: password reset stays on #241. There is no superadmin recovery screen and no email change. No migration.

## Decisions

- The length bound is now read from `passwordLengthLimits` everywhere: accept-invite through Better Auth `minPasswordLength` and `maxPasswordLength`, the change form, `createTenant`, the demo seed, `createSuperadmin`, and `setSuperadminPassword`. The sentence still reads “Password must be 8 to 128 characters.”
- A missing user locale sends the mail in Croatian. The send is not awaited. A failed send logs `mail.password_changed` `send_failed` and does not undo the change.
- The success toast carries `role: 'status'` on the object passed to `toast.add`. Axe runs on the idle form and on the error alert. It does not run while that toast is open.
- After the review, `b3c9811` renamed `length` to `lengthError`, put `role: 'status'` on the toast, and logs every send failure, including a Resend refusal under test, without rethrowing. `9b1a386` points `setSuperadminPassword` at `passwordLengthLimits` after `origin/develop` merged.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (608 tests). `pnpm test:e2e` passed: 260. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; the high and critical findings are ignored).

## Code review

Fixed point `origin/develop`, before that branch merged. The reports below are the review of the pre-commit diff. `b3c9811` followed that review.

### Standards

**Hard violations:** none. Logging stays `userId` plus `outcome` (`auth.password_changed`, `mail.password_changed` `sent` / `send_failed`) with no address, password, or audit row (ADR-0042, Audit and logs; `docs/agents/working-rules.md`, Logging and errors). The form uses the shared length rule, always sends `revokeOtherSessions: true`, and has no checkbox (ADR-0042, Change password). Mail is not awaited, has no link or tenant, and falls back to `hr` (ADR-0042, Password changed notice). Imports are from `shared` and `server/core/index`, not a deep module path (ADR-0018; AGENTS.md). Both locales ship, and the inputs are labeled, `text-base`, and submitted with Enter (`working-rules.md`, i18n and theme).

**Judgement calls**

- **Mysterious Name** — `ChangePasswordForm.vue`: `const length = lengthMessage(nextPassword.value)` holds an error sentence, not a length.
- **Middle Man** — `password-change.rls.test.ts`: `userId` only returns `auth.userIdByEmail(address)`.
- **Duplicated Code** — `async sendPasswordChanged() {}` is copied through `rides.rls.test.ts`, `transfers.rls.test.ts`, `invitation.rls.test.ts`, and `invite-send.test.ts`. The same sentence, `` `Password must be ${passwordLengthLimits.minPasswordLength} to ${passwordLengthLimits.maxPasswordLength} characters.` ``, is copied in `operator.ts`, `create-tenant.ts`, `demo-seed.ts`, and `scripts/demo-seed.ts`.
- **Mysterious Name** — `passwordChangedEmail` is declared to return `InvitationEmail`, which is only `subject` / `text` / `html`.

### Spec

### (a) Missing or partial
None. The shared 8/128 bound, Better Auth `minPasswordLength` / `maxPasswordLength`, the profile form, `revokeOtherSessions: true` with no checkbox, the Croatian wrong-password copy, field errors plus a `role="alert"` summary, session replacement, the mailer port, locale-or-Croatian copy, a non-awaited send, `userId`-only logs, no audit and no migration, hr/en, and the named tests are in the diff. The new e2e block is `@phone`, which the desktop project also runs.

### (b) Not asked for
The new-password field always shows the accept-invite length hint. The spec only asks for the three fields and for a rule failure beside the field: "A rule failure or a mismatched confirmation shows beside its field with a summary using role="alert"."

A 429 shows the sign-in limit copy, and any other failure shows "The password was not changed. Try again." Neither string is in the spec.

### (c) Implemented, but wrong
"Success shows a role="status" toast." The visible toast is a list item with `type: 'background'` and no role. Reka announces that toast as `role="alert"`. `role="status"` is a separate `sr-only` paragraph, which is what the e2e query matches. Other screens pass `role: 'status'` into `toast.add`.

"A failure logs mail.password_changed send_failed and does not fail the change." A normal send error does that. `ResendTransportError` is rethrown from the floating promise and is not logged as `send_failed`, so that failure becomes an unhandled rejection. That throw only happens when the live Resend fetch is used under `NODE_ENV=test`.
