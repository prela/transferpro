# 249 Pending invitations and revoke

The Članovi screen (#262) stays out. It consumes these routes.

## Decisions

- ADR-0041 is accepted. `GET /api/invitations` calls Better Auth `listInvitations` and keeps this Tenant's pending, unexpired rows. Revoke does not call `cancelInvitation`. It updates `auth.invitation` to `canceled` and appends `member.invitation_revoked` on one auth-pool transaction. The admin role stays `invitation: create`, so Better Auth's cancel HTTP route still answers 403.
- Migration `0040_invitation_revoked` adds the audit action and the `audit_entry_shape` branch only. Invitation storage is unchanged. The ticket said no migration; ADR-0014 requires one for a new action.
- The list returns id, email, role, and expiry. The audit entry stores the role only. The email and the invitation id stay off the row. A missing id, another Tenant's id, and one that is no longer pending are the same 404.

## Code review

Fixed point `origin/develop`. The reports below are the review of `4e1f84f`, before the audit e2e and before ADR-0041 was accepted.

## Standards

### Hard

**ADR-0038 left contradicted.** `revokePendingInvitation` updates `auth.invitation` with `status = 'canceled'` on the auth pool, and `0040_invitation_revoked.sql` adds `member.invitation_revoked`. ADR-0038 Members says both the pending read and the revoke "use Better Auth calls, with no migration." `AGENTS.md` says do not contradict an ADR; propose a new one. The same-transaction `appendAuditEntry` plus `openTenantSession` matches ADR-0014 and the Audit section of `docs/agents/working-rules.md` (so the enum migration is required). The breach is that this commit rewrites the Invitations rule to describe the SQL cancel and does not amend ADR-0038. The list path does follow that ADR: `auth.api.listInvitations`.

**UI change with no e2e spec.** `AuditLog.vue` adds a visible `member.invitation_revoked` branch. `AGENTS.md`: "A UI change adds or extends a spec under `e2e/`." The diff has no e2e file.

### Judgement

**Mysterious Name.** `session.ts` imports `revokePendingInvitation as cancelPendingInvitation`, while `invitation.ts` already has a different private `cancelPendingInvitation`. The alias calls the outer function, which then calls the inner one.

**Duplicated Code.** `pending.rls.test.ts` declares `pendingListSchema` (`id`, `email`, `role`, `expiresAt`) next to `pendingInvitationListSchema` in `shared/invitation.ts`.

**Glossary, weak.** New parameters and comments say `organizationId` / "organization id" for the session Tenant. `GLOSSARY.md` lists organization under Avoid. The Better Auth query key has to stay, and this module already uses that name on the adapter.

The audit row itself matches ADR-0014 and the Audit working rule: role only, null subject, no email or invitation id; enum value, Zod shape, check constraint, migration, and both locales are present. Journal `when` is the previous entry plus 1000. Both exported helpers take the Tenant from the session and refuse a non-admin.

## Spec

No `Owner decisions` comments. Judged against #249. #242 and ADR-0038 were used only for the migration conflict.

### (a) Missing or partial

**“No migration.”** and **“`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:rls` pass; no migration.”** Unmet in the letter: `db/migrations/0040_invitation_revoked.sql` adds `member.invitation_revoked` and replaces `audit_entry_shape`.

This is a necessary conflict with ADR-0014, not a miss of the revoke behaviour. ADR-0014: “A new action also needs a branch in `audit_entry_shape`, so the migration that adds the enum value replaces the check too.” #249 also requires the entry (“Revoke writes an audit entry with ids and field names only.”). A new `app.audit_action` cannot be appended without that migration. #242 and ADR-0038 say this read uses Better Auth “with no migration”; they do not account for a new audit enum. The migration adds no table and no column.

The rest of the acceptance list is at the route seam (`pending.rls.test.ts`, included by `test:rls`): pending-only list (accepted, expired, and revoked dropped; email, role, expiry, plus id), revoke makes accept 400, a later invite is a new id, dispatcher and driver 403 and signed-out 401 on both routes, a foreign id is 404 with the same body as a missing id, the audit row has no email and no invitation id, and Better Auth `/organization/list-invitations` stays 404 (`disabledPaths` unchanged). Red-before-green is not visible in the single commit.

### (b) Scope creep

None that changes the product. `AuditLog.vue` and the locale strings only label the action this ticket adds. The Članovi screen is correctly absent (“The Članovi UI ticket of spec #242 consumes these routes.”).

### (c) Implemented but wrong

None.

**“Both call Better Auth on the server.”** List uses `auth.api.listInvitations`. Revoke uses that call to keep the id inside the session Tenant, then `update auth.invitation set status = 'canceled'` in the same auth-pool transaction as `appendAuditEntry` (`member.invitation_revoked`, role only). `cancelInvitation` is not called. That matches ADR-0014: the entry must commit with the action, and Better Auth’s cancel uses its own connection. Accept treats only `status === 'pending'` as usable, so the link stops.

**“The revoke audit entry holds ids and field names only, never the email.”** The row is the actor id, `subjectUserId: null`, and `{ role }`. That matches ADR-0014 (“stores user ids and roles”; “does not store the invitation id”) and `member.invited`. No email.
