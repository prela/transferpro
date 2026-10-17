# Hashed reset identifiers

Status: proposed

## Context

Issue #320. A reset token is stored in `auth.verification.identifier` as `reset-password:<token>`. Anyone who can read the database can use that token for 60 minutes.

Better Auth 1.7.9 can hash a verification identifier (`verification.storeIdentifier`). Hashing the whole identifier drops the `reset-password:` prefix. `deleteRemainingResetTokens` uses that prefix so a successful reset does not delete other verification rows. ADR-0042 says e2e reads the newest `reset-password:%` row because the link is not on a screen. After hashing, that row does not contain the mailed token.

## Decision

We will store a reset identifier as `reset-password-hash:` plus the base64url SHA-256 of the original `reset-password:<token>` string. The Better Auth override stays on the input prefix `reset-password:`. The stored prefix is a different string. Other verification identifiers stay plain. Invitations stay in `auth.invitation`.

`deleteRemainingResetTokens` deletes `reset-password-hash:%` and plain `reset-password:%` for that user. The stored prefix must not be `reset-password:`. After a hashed lookup misses, Better Auth 1.7.9 looks the presented identifier up again as plain text. A row stored as `reset-password:<digest>` makes that digest a working token. `reset-password-hash:` is not the string that fallback looks up. A plaintext row from before this change still matches the fallback, so an old link works until it expires or is used.

E2e no longer reads the token from `auth.verification`. The test server's fake mailer appends `{ to, resetUrl }` to the file named by `E2E_PASSWORD_RESET_OUTBOX`, and only while `NODE_ENV` is `test`. The spec reads the token from that file. The e2e server truncates the file when it starts. Development and production do not set the variable and do not write it. The address and the link stay off the log, as ADR-0042 already requires.

This supersedes the ADR-0042 consequence that e2e reads the newest `reset-password:%` row of `auth.verification`.

## Consequences

A database reader cannot redeem a newly issued reset from the row alone. A row written before the change remains usable until it expires. The e2e file holds the bearer and the address for that run, on the test machine only.

Accepting this ADR updates ADR-0042's status line to name this partial supersession.
