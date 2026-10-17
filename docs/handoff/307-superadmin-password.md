# 307 Superadmin password

Out of scope: Member change and reset stay on #308 and #241. No migration and no audit entry.

## Decisions

- Unknown email, a user without the grant, and a Tenant Member all exit with `No platform owner matches that account.` The sentence omits the email.
- Length stays 8 to 128, the same Zod bound as `superadmin:create`. The shared password rule is #308 and is not on this branch.
- Sessions are deleted before the credential update, in the same transaction. A missing credential throws before commit, and rollback puts the old session back.
- `assertOwner` runs before `begin`. A wrong role writes nothing.
- After the review, `e657dad` names the email-only argument schema for both revoke and password, and a constraint during recovery says the password was not set.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (593 tests). `E2E_PORT=30707 pnpm test:e2e` passed: 246. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; the high and critical findings are ignored).

## Code review

Fixed point `origin/develop`. The reports below are the review of `dda7007`. `e657dad` followed that review.

### Standards

No hard breach of AGENTS.md, `docs/agents/working-rules.md`, or ADRs 0011, 0012, 0018, 0019, or 0042. The script imports the platform `index.ts`, validates with Zod, runs as `transferpro_owner`, refuses `--password`, and uses one fixed sentence that omits the email. ADR-0042 puts this path outside change/reset audit and log lines. ADR-0019’s “only writers” rule is the grant row; this command does not write it. Session deletion is the recovery the ADR requires, not a new `DELETE` grant.

**Judgement — Duplicated Code.** `setSuperadminPassword` repeats `createSuperadmin`: the same password/URL failure cascade, owner pool, `begin`/`rollback`/`commit`, and the user lookup.

```128:133:server/modules/platform/infrastructure/operator.ts
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map(issue => String(issue.path[0])))
    if (fields.has('password'))
      throw new PlatformOperatorError('Password must be 8 to 128 characters.')
```

`scripts/superadmin-password.ts` is the same `main`/`catch` shape as `superadmin-create.ts`. Separate pnpm scripts are the repo pattern, so this is not a hard miss. `signInStatus` rebuilds the same sign-in `Request` as `signIn`.

**Judgement — Mysterious Name.** Password recovery parses with the revoke schema:

```51:53:server/modules/platform/infrastructure/args.ts
export function parseSuperadminPasswordArgs(argv: readonly string[]): { email: string } {
  const values = readFlags(argv, ['email'], passwordUsage)
  const parsed = revokeSchema.safeParse({ email: values.get('email') })
```

**Judgement — shared failure text.** The new path calls `operatorFailure`, whose constraint branch still says “A platform owner cannot be created for that account.” A 23505/42501 on recovery would print the create sentence.

**Not a breach.** `passwordSchema` hardcodes `min(8).max(128)` instead of `passwordLengthRule`. ADR-0042 assigns that helper to the accept, change, and reset forms, and says this script is read like `superadmin:create`, which already uses the same Zod bounds.

### Spec

(a) No missing or partial requirements. The script, the grant check, the length rule, the hasher, the single transaction, the owner-role gate, the redacted output, the working-rules line, and both required tests are in the diff. ADR-0042 already states the recovery sentence on `origin/develop`.

(b) No unasked behaviour. The missing-credential rollback uses the same fixed sentence so the session delete and the hash update commit together.

(c) No requirement looks implemented but wrong.

- "`pnpm superadmin:password --email` reads the new password from the terminal, or from the first line of stdin when there is no terminal, as `superadmin:create` does. `--password` is refused before anything else runs." `main` parses arguments before `readPassword` or the database, and `readFlags` rejects `--password` and `--admin-password`.
- "It works only for a user with a `platform.superadmin` grant. An unknown email, a user without a grant, and a Tenant Member exit 1 with fixed sentences that omit the email." All three throw `No platform owner matches that account.` The script sets exit code 1.
- "The password must pass the same length rule Better Auth enforces, and is hashed with Better Auth's hasher." Zod requires 8–128 characters, matching this app's unset Better Auth defaults, and the hash comes from `better-auth/crypto`.
- "The credential hash update and the deletion of every session of that user run in one transaction. After it, an old session gets 401 and the new password signs in." Both statements run after `begin` and before `commit`. The database test covers two old sessions and a new sign-in.
- "It runs as `transferpro_owner`, like `superadmin:create`. A wrong role exits before any write." `assertOwner` runs before `begin`.
- "Output and logs carry no email and no password." The stdout line and the error sentences are fixed.
- "`docs/agents/working-rules.md` (Superadmin) lists the script beside create and revoke." It does.
- "Tests: the argument parser, and the operator function against the database beside the existing superadmin and platform role suites." Parser coverage is in `args.test.ts`. Database coverage is in `platform-role.rls.test.ts`. No migration and no audit write.
