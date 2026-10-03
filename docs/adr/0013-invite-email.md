# Invitation email and the accept path

Status: accepted

## Context

Public email sign-up stays off. The operator script creates the first admin. Better Auth 1.7 has no sign-up-from-invitation endpoint: `disableSignUp` rejects `POST /api/auth/sign-up/email` before any user row is written, and `acceptInvitation` requires a session whose email matches the invitation. An invited person with no account cannot use either call.

The charter sends transactional mail through Resend, from `noreply@transfers.prela.net`, behind a mailer port, and the admin also gets a copyable link. Resend's API host is `https://api.resend.com`. Choosing region `eu-west-1` dispatches the message from Ireland. Resend's own documentation says account data, including email metadata and logs, stays in the United States under their DPA.

Invitation ids are random UUIDs from `crypto.randomUUID()`. Better Auth treats a custom `generateId` function as non-opaque and would otherwise require a verified email before accept. The id is a bearer secret: anyone who has it can open the invite.

## Decision

We will send invitation email through a `Mailer` port. The Resend adapter posts to `https://api.resend.com/emails` as `Transferpro <noreply@transfers.prela.net>`. The sending region is the domain's `eu-west-1` setting, not a second API host. Account logs remain in the United States, covered by Resend's DPA. `RESEND_API_KEY` is required in the app env schema and optional when `NODE_ENV` is `test`. Tests pass a fake mailer and do not call the network. The message is Croatian or English from the Tenant default locale. The link is valid for 7 days.

`disableSignUp` stays on. `POST /api/invitations/accept` is the only account-creation path besides the operator script. It creates a user only for a pending, unexpired, unused invitation, and it copies the email from that row. The password is checked against the min and max on the Better Auth context used for sign-in, then hashed with Better Auth's hasher, with `email_verified` set. The route then signs the person in and calls Better Auth's accept, which adds the member and sets the active organization. If accept fails, the new user is deleted. An email that already has an account is not given a new password: the accept page says to sign in, and a session whose email matches then accepts. A session whose email does not match is refused. The organization plugin sets `requireEmailVerificationOnInvitation` to false because the ids are still random UUIDs. Only the admin role may create an invitation.

The invite URL puts the id in the hash (`/accept-invite#…`), so a request log of the path does not receive it. `invitationId` and `inviteUrl` are redacted. A string that contains `accept-invite#<id>`, `accept-invite/<id>`, or `invitationId=<id>` is scrubbed, including in a log message. `POST /api/invitations/accept` uses the same production limit as email sign-in: 3 attempts per 10 seconds, off outside production.

`auth.invitation` stays a Better Auth table: no `tenant_id`, no row-level security. A tenant session reads `app.tenant_invitation`, a `security_barrier` view that does not return the email, the same way `app.tenant_member` hides it.

## Consequences

A forgotten tenant filter still cannot return another Tenant's invitations to the app role. The auth role, which Better Auth uses to accept, is not subject to that view; the accept route checks the session email. Swapping the mail provider means a new adapter, not a change to invite or accept. Resend's US account logs are a recorded limit of the EU sending region, not a second copy we control. Slice 2 (change role, remove member, revoke sessions) is not part of this decision.
