# 241 Forgot password

Out of scope: change password stayed on #308. No migration and no audit entry.

## Decisions

- The request returns one body. Eligibility, then the hourly cap, then the mail, run after the response. A Superadmin is never eligible. An archived Driver with a membership is. An invitee with no account gets nothing, and the invitation is not resent.
- The link is `/reset-password#<token>`. After the page reads the token it calls `history.replaceState` and leaves `history.state` in place, so the address bar no longer shows the bearer. `d68e114` added that. The e2e spec asserts the hash is empty.
- A used link fails. `onPasswordReset` deletes the user's remaining `reset-password:%` rows. `revokeSessionsOnPasswordReset` is on, and the presented session is deleted too, including when it belonged to someone else. The page then signs this browser out onto `/?passwordChanged=1`. There is no automatic sign-in.
- The password-changed mail from #308 is queued after a successful reset and is not awaited. The reset limit does not apply to it. Better Auth's 3 requests per 60 seconds per caller address stays.
- The reset form asks for the password twice. If sign-out fails, the page shows the sign-out button again.
- `origin/develop` was merged (`9c3f0bf`, including #312).

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (617). `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` passed: 264 (3.6m). `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 4 high and 2 critical are ignored).

## Code review

Fixed point `origin/develop` (`6d8a721`), before that branch merged and before `d68e114`. The reports below are the review of the uncommitted feature diff.

### Standards

No hard breaches.

Checked against `AGENTS.md` (logs and audit store ids only; Zod on the account and membership reads; the UI change adds `e2e/forgot-password.spec.ts`; mail stays on the fake mailer), `docs/agents/working-rules.md` (both locale files; Nuxt UI; labeled 16px inputs; Enter submits; the request form uses one failure besides 429; `shared/redact.ts` scrubs `reset-password#` and `reset-password/` the way the invite bearer is scrubbed; the logger comes from `server/core`), ADR-0018 and ADR-0019 (platform reads stay `user_id` and `organization_id` on the auth pool), ADR-0016 and ADR-0040 (alerts set `role` and reuse the sign-in contrast override), and ADR-0042 (hash link, unawaited send, no audit row). Glossary terms Member, Tenant, Driver, and Superadmin are used as written. The empty `sendPasswordReset` stubs are the `Mailer` port.

### Judgement

**Duplicated Code.** `eligibleForReset` repeats queries `createAuth` already exposes as `isSuperadmin`, `organizationSuspended`, and `memberships`:

```101:117:server/modules/tenancy/infrastructure/password-reset.ts
  const grant = await pool.query(
    'select user_id from platform.superadmin where user_id = $1',
    [userId],
  )
  // ...
    'select organization_id from auth.member where user_id = $1',
  // ...
      'select organization_id from platform.tenant_account where organization_id = $1',
```

The columns still match the ADR-0019 grants. A second copy can drift. Call the existing methods.

**Duplicated Code.** `reset-password.vue` copies the change-password cascade (`lengthMessage`, mismatch, 429, `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`). ADR-0042 already shares the length check via `passwordLengthRule`; only the form cascade is repeated, matching `ChangePasswordForm.vue`.

**Data clump.** `{ readonly to: string, readonly locale: DisplayLocale }` is inlined on `passwordMailAccount`, `noticePasswordChanged`, and `queuePasswordChangedMail`. `PasswordChangedMail` is that pair. Pass `PasswordChangedMail | null`.

Suppressed: `resetPasswordLink` mirrors `inviteLink` because ADR-0042 keeps the token in the hash, as invitations do. `passwordResetEmail` returns `InvitationEmail` because `passwordChangedEmail` already does.

### Spec

The working tree matches the narrowed forgot-password slice in the 17.10.2026 grill on #241, #305, and ADR-0042. Checked, not assumed: the #308 password-changed mail is queued after a successful reset and is not awaited; `allowResetMail` is not applied to it; Better Auth’s 3 requests per 60 seconds stays (default special rule on `/request-password-reset`); there is no audit write and no migration; the link is `/reset-password#<token>`; eligibility is one `auth.member` row whose organization has no `platform.tenant_account` row, and any Superadmin is refused first; an archived Driver with a membership is mailed; an invitee with no account gets no mail and the invitation is not resent.

### (a) Missing or partial

None. Sign-in link, one success answer, unawaited eligibility-then-limit-then-send, same body for known, unknown, ineligible, and hourly-limited addresses (including a mailer that never settles), 60-minute single-use token, `onPasswordReset` deleting remaining `reset-password:%` rows, GET `/api/auth/reset-password/<token>` returning 404, `revokeSessionsOnPasswordReset` plus deleting the presented session, sign-out to `/?passwordChanged=1` with no automatic sign-in, `userId`-only logs, hash redaction, both locales, and the HTTP and e2e coverage the ticket names are in the diff.

### (b) Scope creep

The reset form asks for the new password twice and blocks submit when they differ (`profile.passwordMismatch`). #241 says only: “The reset page sets a new password, signs out every session including this browser, and opens sign-in.” Confirmation is #305 story 6, under Change password, which moved to #308.

If sign-out fails, the reset page shows a second “Sign out” button. The spec does not describe that failure path.

### (c) Implemented but wrong

None. The hourly cap is after eligibility and is keyed by the lowercased address. A new request does not delete older links. Unknown addresses never enter `sendResetPassword`, so no address is logged. Console lines are `kind: 'password-reset'` only.
