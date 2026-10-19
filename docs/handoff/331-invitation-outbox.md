# 331 Invitation outbox

Out of scope: the 90-day delete, a role check for the worker's attempt loaders (the worker has no actor), and repairing the local `mail_outbox_shape` check.

## Decisions

- ADR-0047, accepted by Damir on 19.10.2026, amends ADR-0045 for invitations. The auth pool and the app pool cannot share a transaction. The invite call checks the Admin role and the settings row on a tenant transaction that commits before Better Auth is called. Better Auth then creates the invitation. A new tenant transaction writes the entry (kind `invitation`, the invitation id only) and its one-minute job. A further tenant transaction makes the first attempt, and the invite call waits for it.
- The tenancy module defines `InvitationMailPort`. The route passes `invitationMailOutbox()` from the mail module, because mail already imports tenancy. The pg-boss mail queue moved from transfers to mail, and transfers re-exports it.
- Better Auth sends no invitation mail. `sendInvitationEmail` is removed, and its `/organization/invite-member` HTTP route is disabled.
- The dialog has four outcomes:
  - `sent`.
  - `retrying`: "Mail nije poslan, pokušat ćemo ponovno".
  - `stale`: ADR-0045 requires that a first attempt that is no longer current says so.
  - `not_sent`: the entry could not be written, so nothing retries it. One `mail_outbox.invitation_not_recorded` log line carries no id and no address. The link is always returned.
- Retries follow the work-order schedule: 1, 5, then 30 minutes, at most 4 sends. Every attempt composes from the invitation, the Tenant name, and the Tenant default locale. The idempotency key is the entry id plus a hash of the message and recipient, never the invitation id.
- Home lists failed, still-pending invitations to the Admin only. The invitee's email is read from the auth role when the list is shown, and `readInvitationEmails` checks the Admin role itself. The resend route asks for the entry's kind first. A Dispatcher gets 403 for an invitation entry, and another Tenant's entry is 404.
- No migration. Table 0045 already has the invitation columns.
- Flagged tests:
  - `invite-send.test.ts` (4 tests) is deleted together with the Better Auth send it covered.
  - In the first test of `invitation.rls.test.ts`, the role and locale checks of the sent mail became "nothing sent". `invitation-outbox.rls.test.ts` and `invitation.test.ts` now cover composition and the failure path.
- Results after merging `origin/develop` (`43ae3a3`):
  - `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (699) passed.
  - `pnpm test:e2e` passed: 282 tests in 4.0m, on database `transferpro_e2e` only, with no other Playwright run going.
  - The relevant `pnpm test:rls` files passed.
  - In the whole `pnpm test:rls`, only the known local drift test fails: `outbox.rls.test.ts`, "refuses an assigned work order that names a vehicle".

## Code review

Fixed point `origin/develop` (`43ae3a3`). Reviewed commit `0101f7d`. Both subagents started with `fast=false`. The reports below are that review.

### Standards

## Standards

**Hard violations (documented rules)**

1. **The role allow-list is not enforced in the helpers that return invitee data.** `AGENTS.md` (Security) says: "Every route and every loader or helper that returns tenant data enforces the role allow-list itself; do not rely on the caller."
   - `tenancy/infrastructure/session.ts` `readInvitationForMail(tenantId, invitationId)` is exported from the tenancy index. It returns the invitee email and the bearer link, and it checks no role.
   - `mail/infrastructure/invitation-attempt.ts` `loadInvitationAttempt` is exported from the mail index and is used by the resend in `transfers/.../failed-mail.ts`. It also checks no role.
   - `mail/application/resend.ts` says so outright: "The caller has already checked the role for this kind."
   - The worker path has no actor, so it needs either a system-actor allow-list or an ADR exception.
2. **Removed tests are not flagged.** `AGENTS.md` (Workflow) says: "Never weaken or remove a test; flag any." No commit message flags these:
   - `tenancy/infrastructure/invite-send.test.ts` is deleted (4 tests).
   - `invitation.rls.test.ts` drops `expect(sent.map(mail => mail.role))…`, the `locale === 'hr'` check, and `expect(driver.emailSent)`.
   - Coverage appears to have moved to `invitation-outbox.rls.test.ts` and `invitation.test.ts`, but the removals still have to be flagged.

**Judgement calls (baseline smells)**

- **Comments that narrate history or code** (against the `AGENTS.md` comment rule):
  - `invitation.rls.test.ts`: "Better Auth no longer sends…"
  - `mail-outbox-worker.ts`: "The queue lives in the mail module…"
  - `attempt.ts`: "// A composition failure still counts below."
- **Possible Duplicated Code:**
  - `firstOutboxAttempt` repeats the stale-save block from `attemptOutboxEntry`.
  - `toOptionalInstant` exists in both `mail/infrastructure/invitation-attempt.ts` and `transfers/infrastructure/work-order-attempt.ts`.
  - The `ResendTransportError` rethrow, with the same comment, now appears in `sendEntry`, `deliverNewInvitation` and `inviteMember`.
  - The log event `mail_outbox.invitation_not_recorded` is emitted from both `deliverNewInvitation` and `inviteMember`.
- **Possible Repeated Switches:** `kind === 'invitation'` is checked in `entryIsCurrent`, `sendEntry`, `resendStore` (as a ternary) and `OfficeFailedMail.vue` (`resendLabel` plus the template). `outboxStoreByKind` already uses a `Record<OutboxKind, …>` map, and `resendStore` could reuse that shape.
- **Possible Primitive Obsession:**
  - Better Auth's invitation `status: string` is compared to `'pending'` in `InvitationCurrentFacts`, `InvitationForMail`, `InvitationForMailRecord` and `failedInvitationRowSchema`.
  - The outbox kind and state are restated by hand: `OutboxKind` is in infrastructure, while the literal `kind` fields on `LoadedOutboxEntry` and the `z.enum` in `kindRows` repeat it. The state union `'pending' | 'sent' | 'failed' | 'stale'` is repeated in `attempt.ts` and `invitation-attempt.ts`.
- **Possible Data Clumps:** `(transaction, context)` travels together through `invitationAttemptStore`, `loadInvitationAttempt`, `resendStore` and `openStore`. `{ context, role }` travels through `loadOfficeHome(viewer)`, `loadFailedInvitations(transaction, context, role, now)` and `readInvitationEmails`. Using `Pick<Actor, 'context' | 'role'>` everywhere would bundle it.
- **Possible Middle Man:** `transfers/.../mail-outbox-worker.ts` only re-exports `mailOutboxQueue` and wraps `closeMailOutboxQueue` from the mail module, and `transfers/index.ts` exports them again.
- **Possible Divergent Change (ADR-0018 boundary):** `transfers/infrastructure/failed-mail.ts` now owns the Admin-only failed-invitation query, reads invitee emails, and picks between the invitation loader and the work-order loader. Invitation logic is living in transfers.
- **Zod boundary is weak in two places:**
  - `auth.ts` `invitationForMail`: when `safeParse` fails it returns `null`, and the attempt treats that as a missing invitation and marks the mail stale. A malformed row is silently treated the same as one that is gone.
  - `failedInvitationRowSchema` uses `expiresAt: z.unknown()`, and the value is only coerced later by `toInstantDate`.

The rest follows the standards: imports between modules go through each module's `index.ts`, the Tenant comes from the session or the job envelope, logs carry only the entry id, ADR-0047 is accepted, and there is an e2e spec for the UI change.

### Spec

## Spec

**(a) Missing or partial**

Nothing is missing. I checked each acceptance criterion against the diff and found code and tests for all of them:

- **Outbox entry:** the entry has kind `invitation` and holds only the invitation id. The invite call waits for the first attempt.
- **Composing the mail:** each attempt reads email, role, Tenant name and the Tenant default locale.
- **Current-ness:** `invitationIsCurrent` is current only while the invitation is pending and unexpired.
- **Home block:** only the Admin sees failed invitations; the email is read when the block is shown.
- **Resend route:** it refuses a Dispatcher with 403 itself, and another Tenant's entry gets 404.
- **Audit:** no entry for a send or a resend.
- **Copy and themes:** Croatian and English copy, checked in light and dark.
- **Tests:** an HTTP seam test, a log-redaction test, and the e2e failing-send plus resend-from-Home test.

**(b) Not asked for (scope creep)**

1. **A fourth dialog outcome, `stale`, with its own copy.** The new keys are `invite.emailStale` and `"Mail nije poslan jer pozivnica više nije na čekanju…"`. The spec asks for two messages: *"A failed first attempt shows 'mail nije poslan, pokušat ćemo ponovno'"* and, from ADR-0047, the "not sent" message. An invitation created a moment earlier is almost never stale on its first attempt, so this adds copy and a UI branch nobody specified. It's harmless, but it should be confirmed or dropped.
2. **Better Auth's `/organization/invite-member` route is now disabled.** The issue doesn't ask for this. The accepted ADR-0047 does (*"Its own invite route is disabled"*), so it's covered, but the PR should say so.
3. **The invite call now checks the Admin role itself.** `inviteMember` throws 403 before Better Auth runs. This matches the owner rule that the route enforces the allow-list itself, so it's in scope, just new behaviour.

**(c) Implemented, but the implementation looks wrong or debatable**

1. **The resend route looks up the entry's kind before the role check.** *"A Dispatcher never sees them and gets 403 on resending one."* A Dispatcher gets 403 for an invitation entry and 404 for an unknown id. So a Dispatcher can tell that an invitation entry exists in their own Tenant. The spec does require the 403, so this follows the letter of it. It's only an existence signal inside one Tenant and never reveals the id or the email.
2. **The "not sent" case keeps today's final wording.** That wording is *"The email was not sent. Copy the link and send it yourself."* AC2 says *"instead of today's final wording"*. But ADR-0047 deliberately keeps the old wording for the no-entry case, so the Admin knows nothing will retry. This is consistent with the ADR, as long as it's read as overriding AC2 for that case only.
3. **ADR-0013 doesn't mention ADR-0047.** Spec #325 says *"Partially supersedes ADR-0013 … now also says the send is retried."* ADR-0013's status line still reads *"partially superseded by ADR-0037 and ADR-0045"*. It's arguably fine because ADR-0047 amends ADR-0045, not ADR-0013.
4. **A failed first attempt doesn't queue a new job.** *"Retries … behave as for work orders."* The job queued for one minute later, when the entry is written, serves as the first retry. The work-order path does the same, so I'm not counting this as a defect.

The bearer-secret rule holds. The Home read and the resend route name only the entry id. Log lines carry either just the event name (`mail_outbox.invitation_not_recorded`) or the entry id. The idempotency key hashes the link and never contains the invitation id.
