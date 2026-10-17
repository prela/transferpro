# Password change and password reset

Status: accepted; partially superseded by ADR-0044

Damir accepted this on 17 October 2026, in the grill of #241. It partially supersedes ADR-0037 and one sentence of ADR-0038, as listed under Superseded.

## Context

A Member who forgets their password can come back today only through a new invitation or the operator script. Issue #241 makes change and reset a pilot requirement, without widening the auth surface.

Better Auth 1.7.9 already has `/change-password`, `/request-password-reset`, and `/reset-password`. Its defaults leave some gaps. A known email waits for the send and an unknown one does not, so the response time tells them apart. Its link puts the token in the path (`/api/auth/reset-password/<token>`). A successful reset leaves the user's other reset tokens valid. The only built-in limit is 3 requests per 60 seconds per address of the caller, and only in production. One sender can therefore spend the Resend daily quota that invitations and work orders share. `disabledPaths` matches exact paths, so it cannot turn off a route with a token in it.

A fresh session has no active organization. `chooseMembership` resolves one membership and refuses two or more. A new session created by sign-in, a reset, or a change with `revokeOtherSessions` therefore leaves a person with two Tenants on the 403 screen. Better Auth's `organization/set-active` route is enabled, and no screen calls it.

## Decision

### Change password

`/profile` has a form for every Tenant role: current password, new password, and confirmation. It calls Better Auth's `/change-password`. The current password is required, a wrong one shows "Trenutna lozinka nije točna", and the Better Auth limit of 3 attempts per 10 seconds stays. The form always sends `revokeOtherSessions: true`: every other session of the user is deleted and the current browser stays signed in. There is no checkbox.

### Request a reset

Sign-in shows "Zaboravljena lozinka?". The request form takes an email and always shows the same answer. Better Auth's `sendResetPassword` callback does no work in the request: it hands delivery to a task that is not awaited and returns. That task alone decides whether a mail goes out:

- The account must have at least one membership in an active Tenant. A removed Member, a Member whose only Tenant is deactivated, and a Superadmin receive nothing. An archived Driver is still a Member and receives the mail; archiving does not block sign-in.
- An email with no account receives nothing, including an invitee who has not accepted yet. The invitation is not resent; an admin sends it again.
- At most 3 reset mails per address per hour, counted in process memory. Above that, nothing is sent.

Better Auth's 3 requests per 60 seconds per caller address stays. The response is the same for a known, an unknown, an ineligible, and a limited email, and it does not wait for any of those checks or for the send.

### Reset link and page

The mail carries our own URL, `/reset-password#<token>`, built from the `token` Better Auth passes to the callback. The token stays in the hash, as with invitations, so no request log receives it. The page sends the token in the body of `POST /api/auth/reset-password`. Better Auth's GET `/api/auth/reset-password/<token>` callback is not used, and the auth catch-all answers it with 404, because `disabledPaths` cannot match it. `shared/redact.ts` scrubs `reset-password#<token>` like `accept-invite#<id>`.

The link lasts 60 minutes (`resetPasswordTokenExpiresIn`) and works once. A new request does not cancel earlier links. A successful reset deletes every remaining reset token of that user in `onPasswordReset`.

A reset deletes every session of the user (`revokeSessionsOnPasswordReset`). It does not sign anyone in. The page then signs the browser out and opens sign-in with "Lozinka je promijenjena, prijavite se". The token decides which account changes, not the session. Someone who opens the link while signed in, as themselves or as another person on a shared office computer, still resets that account and ends on sign-in. An expired or used link says so and offers a new request.

### One password rule

The minimum and maximum length live in `shared/` beside `passwordLengthRule` and are passed to Better Auth as `minPasswordLength` and `maxPasswordLength`. The accept-invite form, the change form, and the reset form all use that rule. The accept route keeps checking it on the server, and change and reset rely on Better Auth's check of the same numbers.

### Password changed notice

After a successful change or reset, the user receives a "Lozinka je promijenjena" mail. It is the only signal that someone else took the account. The send is not awaited and does not count against the reset limit; the change limit and single-use reset links bound it. The mail names no Tenant, carries no link, and says to contact the company's administrator if the change was not yours.

Both mails go through the mailer port, in the user's locale, or Croatian when none is chosen. A user with two Tenants has no single Tenant default. Neither mail carries a name, a Tenant, or anything beyond what it needs.

### Audit and logs

Neither a change nor a reset appends an audit entry. It is an account fact and not a Tenant's: a Superadmin has no Tenant, and a person with two Tenants has no single audit log. Each writes one log line with `userId` only:

- `auth.password_changed`, `auth.password_reset`.
- `mail.password_reset` with outcome `sent`, `send_failed`, `limited`, or `not_eligible`. A limited request and a failed send are different outcomes.
- `mail.password_changed` with `sent` or `send_failed`.

An unknown email has no user id and logs no address. The link, the token, and the address are never logged, on every environment.

### Superadmin

A Superadmin is outside both flows. A reset sends them nothing, because ADR-0019 has no second factor and their mailbox must not open the platform. The platform has no `/profile`. Recovery is an operator script, `pnpm superadmin:password`, read like `superadmin:create`. Without it there is no safe recovery, so it ships before the pilot starts.

### Email change

Changing the sign-in email stays out of v1: Better Auth's `changeEmail` stays off and `/profile` shows the email read only. A reset token is bound to the user id, not the address. Whatever later changes an email must, in the same step, delete that user's reset tokens and sessions, and must update the email copied onto a linked Driver.

### Preview mail

Preview sends real mail through Resend only to the addresses in `MAIL_ALLOWLIST` (comma separated). With the list set, the mailer port sends a listed recipient through Resend and writes every other recipient as today's console line, for every kind of mail. Preview sets `MAILER=resend`, `RESEND_API_KEY`, and `MAIL_ALLOWLIST`. Production leaves `MAIL_ALLOWLIST` unset. Development and test are unchanged: test always gets the fake mailer.

### Superseded

ADR-0037: preview no longer uses `ALLOW_CONSOLE_MAILER=1` with `MAILER=console`. It sends through Resend to the allowlist. The flag stays valid for a deployment that wants console only.

ADR-0038, Sign-in: "'Zaboravljena lozinka?' is not shown until auth ships it." Sign-in now shows it.

## Consequences

The reset limit counts inside one process and is empty after a restart. A second instance, or a restart, gives a sender a fresh count. That is accepted for one pilot instance. Several instances need a shared store.

Because the eligibility check runs after the response, Better Auth stores a reset token for an ineligible account as well. Nobody receives it, and it expires in 60 minutes.

A required test proves that a known, an unknown, and a limited email answer equally fast. It uses a fake mailer whose send never settles, so the result does not depend on timing noise. All three requests must return, with the same body.

E2e reads the newest `reset-password:%` row of `auth.verification` in `transferpro_e2e`, because the link is not on any screen.

A person with two Tenants loses the Tenant after a reset or a change, as after any fresh sign-in. The way back is a Tenant choice after sign-in over Better Auth's existing `set-active`, which is a separate ticket. On 17 October 2026, the local databases held no real person with two memberships; the only one was an RLS test fixture. Whether that ticket blocks the pilot depends on preview and production, which an agent may not read.

Preview spends the shared Resend quota, bounded by the allowlist. If the list is set in production by mistake, real recipients get a console line instead of mail.
