# Append-only audit log

Status: proposed

## Context

The Charter asks for an audit entry for every admin action and every Ride state change. An entry that the app role can rewrite proves nothing, so the database has to refuse the change, not only the code. An entry must also commit with its action: an action without an entry, or an entry for an action that rolled back, is a false record.

The first actions are member actions, and they do not run on the app role. Role change and removal run on the auth role in one transaction that holds the Tenant's advisory lock. Better Auth inserts an invitation on its own auth-role connection. ADR-0011 keeps the auth role off schema `app`.

We looked at five ways to put the entry in the action's transaction. Granting the auth role `INSERT` on the table opens schema `app` to it and needs a second policy. Making the auth role a member of the app role lets it become the app role. Two-phase commit needs prepared transactions, which are off. A compensating delete is not atomic and cannot run on an append-only table. Taking invitations away from Better Auth would mean writing its checks again.

## Decision

We will keep entries in `app.audit_entry`, declared through `tenantTable()` with FORCE RLS. `tenant_id` is not its key, because a Tenant has many entries.

Append-only is enforced in three places:

- No role is granted `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` on the table. The app role may `SELECT`.
- Row-level security limits reads to the session's Tenant.
- A `BEFORE UPDATE OR DELETE OR TRUNCATE` statement trigger refuses all three for every role, the owner included.

A change needs a reviewed migration that drops or disables the trigger.

Two functions in schema `audit` write rows. Both are `SECURITY DEFINER`, owned by `transferpro_owner`, with `search_path` set to `pg_catalog, pg_temp`, so a caller's temporary objects cannot stand in for a name.

- `audit.append_entry(action, actor_user_id, subject_user_id, data)` is the one path for application code. It takes the Tenant from `app.current_tenant_id()` and refuses when that is unset. The app role and the auth role may execute it. Schema `audit` keeps it apart, so the auth role still has no grant on schema `app`. Once this ADR is accepted, it amends one sentence of ADR-0011: besides Better Auth's tables, the auth role may execute this one function.
- `audit.record_invitation()` is an `AFTER INSERT` trigger on `auth.invitation`, because Better Auth inserts the invitation on its own connection without a tenant session. It writes `member.invited` with the inviter as the actor, in the same transaction. No role can call it directly.

Role change and removal open the kernel's tenant session on the locked auth-role connection and append before commit.

Actions are the Postgres enum `app.audit_action`, declared from `auditActions` in `shared/audit-entry.ts`. Adding an action adds an enum value, which does not rewrite existing rows. Each action has a strict data shape, checked twice: by Zod before the append, and by the table check `audit_entry_shape` for every writer, the trigger and the owner included. A role outside the Tenant roles, a missing member, or an extra key such as an email is refused, and the action with it. A row that is never deleted must never need to be.

An entry stores user ids and roles. It does not store names or emails. It does not store the invitation id either, because that id is the invite link. Names are read when the log is shown, from `app.tenant_member`. The user ids have no foreign key, so an entry outlives the membership and the user. Only an admin reads the log, through `GET /api/audit-entries`.

## Consequences

An append without a tenant session fails, and the action fails with it. A bug in application code cannot rewrite an entry. The migrator can, but only through a migration someone reviews.

The auth role can append an entry to any Tenant. It can already change any Tenant's members, so this adds little. It cannot read entries.

The database does not check the actor. `append_entry` stores the user id the server passes, which is the signed-in admin's. A bug that passes the wrong id writes a wrong but well-formed entry, and it cannot be corrected in place, only followed by another entry.

A new action also needs a branch in `audit_entry_shape`, so the migration that adds the enum value replaces the check too.

A person who has left the Tenant appears as a former member, because their name is no longer in `app.tenant_member`. Erasing a user leaves only an id in the log, so an append-only table does not block erasure. A member whose stored role is not a Tenant role can no longer have their role changed or be removed, because that change cannot be logged. The request is refused with 409 before any write.

Paging, retention, and superadmin access entries are left for later. A superadmin entry can use the same function: the actor is a user id, not a membership.
