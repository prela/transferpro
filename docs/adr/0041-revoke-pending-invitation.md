# Revoke a pending invitation

Status: accepted

This amends one sentence of ADR-0038. The pending list still calls Better Auth. The revoke does not.

## Context

ADR-0038 says the pending read and the revoke both use Better Auth, with no migration. Issue #249 also requires an audit entry that stores ids and field names only, never the email and never the invitation id.

ADR-0014 requires that entry to commit with the action. Better Auth's `cancelInvitation` writes `status = canceled` on its own connection, so an audit append after it can fail and leave a canceled invitation with no row. A retry then finds nothing pending, and the entry is never written. The admin role also has only `invitation: create`. Granting `cancel` would let `POST /api/auth/organization/cancel-invitation` succeed and skip this app's 404 for a foreign id. Disabling that HTTP path would change the disabled-path list, which #249 leaves as it is.

A new `app.audit_action` value cannot be stored without a migration. ADR-0014 says the migration that adds the value also replaces `audit_entry_shape`.

## Decision

`GET /api/invitations` calls Better Auth's `listInvitations` and keeps this Tenant's pending, unexpired rows. The Tenant comes from the session.

`POST /api/invitations/:invitationId/revoke` uses that same list to refuse a missing id, another Tenant's id, and one that is no longer pending, all as 404. It then updates `auth.invitation` to `canceled` and appends `member.invitation_revoked` on one auth-pool transaction. The update matches the status write Better Auth's cancel performs, and it also requires the row to still be pending and unexpired. The entry's data is `{ role }` and the subject is null. Sending again is a new invitation.

The migration adds the enum value and the check branch only. It does not change invitation storage.

## Consequences

The revoke audit cannot commit without the status change, and the status change cannot commit without the entry. Better Auth's cancel HTTP route stays enabled and still answers 403, because the admin role does not have `invitation: cancel`. A future reader of ADR-0038 will see a sentence this record replaces.
