# 320 Hashed reset tokens

Out of scope: other verification identifiers stay plain, and invitations stay in `auth.invitation`.

## Decisions

- A new reset row is `reset-password-hash:` plus the base64url SHA-256 of `reset-password:<token>`. The Better Auth override stays on the input prefix `reset-password:`.
- The stored prefix must differ from the plain one. After a hashed lookup misses, Better Auth 1.7.9 looks up `reset-password:<presented>` as plain text, so a shared prefix makes the row suffix a working token.
- `deleteRemainingResetTokens` deletes `reset-password-hash:%` and plain `reset-password:%` for that user. A plaintext row from before this change still matches the fallback until it expires or is used.
- E2e reads the token from the fake mailer's test outbox, not from `auth.verification`. The file is written only while `NODE_ENV` is `test` and `E2E_PASSWORD_RESET_OUTBOX` is set.
- ADR-0044 is accepted. ADR-0042's status line names the partial supersession. The rest of ADR-0042 is unchanged.
- `origin/develop` was merged (`85c374c`, including #321).

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (618). `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` passed: 266 (3.6m). `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 4 high and 2 critical are ignored).

## Code review

Fixed point `origin/develop` (`5b98704`), before the stored-prefix fix and before `origin/develop` was merged. The reports below are the review of the uncommitted feature diff.

### Standards

**Hard.** Hashing the reset identifier and reading the token from a JSONL outbox contradict an accepted ADR, and the diff does not supersede it.

`docs/adr/0042-password-change-and-reset.md` (Consequences): "E2e reads the newest `reset-password:%` row of `auth.verification` in `transferpro_e2e`, because the link is not on any screen." `e2e/forgot-password.spec.ts` drops that query. `tokenFromOutbox` reads `E2E_PASSWORD_RESET_OUTBOX` and takes `resetUrl`'s hash. `scripts/e2e-reset-outbox.mjs`, `playwright.config.ts`, and `scripts/e2e-server.mjs` exist to feed that file. `password-reset.ts` (`hashResetPasswordIdentifier`) and `auth.ts` (`verification.storeIdentifier`) are why the row no longer holds the mailed token.

`AGENTS.md` (Read first): do not contradict an ADR; propose a new one; update an ADR when a decision changes. `docs/adr/README.md` (Format): an accepted ADR is not edited; it is superseded.

Same ADR (Audit and logs): "The link, the token, and the address are never logged, on every environment." `mailer.ts` `rememberResetForE2e` appends `{ to, resetUrl }` — the address and the bearer — while `NODE_ENV` is `test`. That is a file, not the logger, so it is the same decision change, not a second logging-rule miss. The console mailer in that file still keeps both off the log line.

**Judgement — Duplicated Code.** The same hash slice appears in both readers:

```ts
const hash = new URL(row.data.resetUrl).hash.slice(1)
```

`e2e/forgot-password.spec.ts`

```ts
const token = resetUrl === undefined ? '' : new URL(resetUrl).hash.slice(1)
```

`password-reset.rls.test.ts` (`resetTokenFromMail`)

One helper would serve both. No other baseline smell. The `.d.mts` stub matches `scripts/e2e-database.d.mts`.

### Spec

### (a) Missing or partial

**ADR-0042 is left false.** "E2e reads the newest `reset-password:%` row of `auth.verification`." `e2e/forgot-password.spec.ts` no longer queries that table. The token comes from a JSONL file, and the diff does not amend the ADR.

**Other flows are not checked through Better Auth.** "Provjeriti da pozivnice i ostali verification tokovi i dalje rade." The override is only `reset-password:` and `default` is `plain`, which is the right shape. Nothing in the diff sends or accepts an invitation, or stores a non-reset identifier through Better Auth. The new `keep-verification:not-a-reset` row is inserted with SQL and only shows that `deleteRemainingResetTokens` skips other prefixes.

### (b) Scope creep

"Uključiti hashirano spremanje" plus the prefix delete and a database assertion. The diff also adds `scripts/e2e-reset-outbox.mjs`, sets `E2E_PASSWORD_RESET_OUTBOX` in Playwright, truncates that file in `scripts/e2e-server.mjs`, and has `createFakeMailer` append `{ to, resetUrl }` — the bearer link — to disk.

### (c) Implemented but looks wrong

Against that ADR sentence: e2e, and `latestToken` in the RLS tests, take the token from mail. Hashing means the row cannot yield the token, so the accepted read cannot stay as written without an ADR change. The stand-in keeps the plaintext reset URL on disk for the e2e run.

Hashing itself matches the issue. `verification.storeIdentifier` overrides `reset-password:` with a prefix-preserving SHA-256, so `delete from auth.verification … identifier like 'reset-password:%'` still hits hashed rows and older plaintext ones. `stores a hashed reset identifier and not the mailed token` checks the row, then resets with the mailed token.
