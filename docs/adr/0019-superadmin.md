# Superadmin

The platform owner lists, opens, and renames firms. Opening a firm shows only its metadata. An operator script deactivates a firm. A superadmin is not a member of any firm.

## Status

Accepted (Damir, 5.10.2026)

## Context

Better Auth's organization plugin is the tenant directory: `auth.organization` is the firm, `auth.member` is who belongs to it, and `app.tenant_settings` is the firm's own row. There is no platform role. The operator script `pnpm tenant:create` is the only way to add a firm.

Issue #13 asks for a superadmin who can see the firms, open one, and rename it. The owner decided the v1 screen stops there. Deactivating a firm is an operator script, not a page and not an API.

## Decision

### Hard limit

A superadmin can list firms, open one firm, and rename that firm.

Opening a firm returns and shows only:

- name
- slug
- created time
- whether the firm is active

That response and that screen never include clients, drivers, vehicles, rides, transfers, members, an audit log, a member count, or any other row from schema `app`. There is no `memberCount` field and no view that counts members.

List and open do not append an audit entry. Rename appends `tenant.renamed` on that firm's audit log, with an empty data object and no person's name. The actor is the superadmin's user id.

### Deactivate and reactivate

There is no suspend or reactivate UI and no HTTP route for it in v1.

`pnpm tenant:account --slug <slug> --deactivate` and `--reactivate` are the emergency lever. They run as `transferpro_owner`, the same way `tenant:create` does. A missing firm, or a firm that is already in the requested state, exits without an audit entry. A real change appends `tenant.suspended` or `tenant.reactivated` with an empty data object. The actor stored on that row is the role name `transferpro_owner`, not a person.

The marker is `platform.tenant_account`. No row means the firm is active. A row means the next request from an admin, dispatcher, or driver of that firm is the ordinary 403. Existing sessions are not deleted. Accepting an invitation for a deactivated firm is refused before any user row is inserted. Reactivating removes the marker; the next request works again.

### Who a superadmin is

`platform.superadmin` holds `user_id`. `pnpm superadmin:create` and `pnpm superadmin:revoke` are the only writers. Both run as `transferpro_owner`. The password is read from the terminal, or from the first line of stdin when there is no terminal. `--password` is refused.

Create inserts the user, the credential account, and the grant in one transaction. It creates no organization, no member, and no settings row. A duplicate email, an existing membership, or an existing grant exits 1 with one fixed sentence that omits the email. Revoke deletes the grant and leaves the user row. A missing grant exits 1 with a different fixed sentence that also omits the email.

Two triggers refuse the mixed case. A member insert fails when the user is already a superadmin. A superadmin insert fails when the user is already a member. Both functions are `SECURITY DEFINER` with `search_path` pinned to `pg_catalog, pg_temp`, and they use schema-qualified names. `transferpro_auth` may execute the member trigger's function, because invitation accept and `tenant:create` insert members as that role.

`PlatformActor` is `{ userId }`. It is not a `TenantContext` and it has no `tenantId`. `withTenantFromSession` and `openTenantSession` do not accept it. `GET /api/session` stays 403 for a superadmin, so the tenant app does not open.

### Role

`transferpro_platform` is `LOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`. The migration raises if the role is missing. The password is set outside the migration, as for the other roles. `PLATFORM_DATABASE_URL` is this role and is part of `AppEnv`. `DATABASE_MIGRATE_URL` stays out of `AppEnv`.

Boot runs the shared probe, then requires `current_user` to be `transferpro_platform` and `has_schema_privilege(..., 'app', 'USAGE')` to be false. The auth URL fails the name check. The owner URL fails the shared probe because it bypasses RLS.

Grants, and nothing else:

- `USAGE` on schemas `auth`, `platform`, and `audit`. No `USAGE` on `app` or `pgboss`.
- `SELECT (id, name, slug, created_at)` and `UPDATE (name)` on `auth.organization`.
- `SELECT (organization_id)` on `platform.tenant_account`. No insert, update, or delete.
- `EXECUTE` on `audit.append_entry(text, text, text, jsonb)`.

`transferpro_auth` may `SELECT (user_id)` on `platform.superadmin` and `SELECT (organization_id)` on `platform.tenant_account`. It cannot write either table. `transferpro_app` has no `USAGE` on schema `platform`.

The catalog test names the grants and fails if another privilege appears. It also fails if the platform role can `SELECT` any relation in schema `app` (including clients, drivers, vehicles, the audit log, and members) or `DELETE` anywhere.

### Request path

`GET /api/platform/session`, `GET /api/platform/tenants`, `GET /api/platform/tenants/:id`, and `PATCH /api/platform/tenants/:id`.

The guard runs before any id is parsed and before any row is read. No session is 401. A signed-in user who is not a superadmin is 403, including a tenant admin, dispatcher, or driver, and including a non-uuid or an unknown id. A superadmin gets 400 for a non-uuid and 404 for an unknown id. A body that is not `{ name }` is 400 and the response does not echo the body.

After sign-in, a 200 from `GET /api/session` stays on the tenant app. A 403 there and a 200 from `GET /api/platform/session` goes to `/admin/tenants`. A 403 from both is the existing forbidden screen.

Every platform route writes one pino line: actor user id, action, target tenant id, outcome. The target tenant id is set only when the raw id is a uuid; parsing the URL is not a lookup. The line has no names and no request body. `userId` is the field the redaction list keeps. `targetTenantId` is not `tenant_id`, because the logger strips that name as the tenant-session scope. Unexpected failures are `error`. Every other outcome is `info`. Rate limiting these routes is out of scope for v1.

A superadmin session lasts 8 hours from `createdAt` (`SUPERADMIN_SESSION_SECONDS`). The cap is applied when the session is created and when it is updated, so a refresh cannot stretch it to the normal 7 days. A trigger on `auth.session` clamps `expires_at` to `created_at` plus eight hours for a superadmin, including a refresh that only sends a new expiry. A tenant member's session is unchanged.

### Screens

`/admin/tenants` and `/admin/tenants/:id` call only `/api/platform/*`. Croatian is the default. The locale and theme controls are the same client controls as the tenant app. The locale button does not call `POST /api/locale`, because that route opens a tenant session and a superadmin has none. Inputs are labeled, 16px, and submit with Enter. There is no link to clients, drivers, vehicles, transfers, or rides.

### Migrations

`0010_platform_superadmin` creates schema `platform`, `platform.superadmin`, and the two exclusion triggers, and grants `transferpro_auth` the `user_id` column and execute on the member trigger function.

`0011_platform_directory` grants the organization columns and creates `platform.tenant_account` with a select grant on `organization_id` for the platform and auth roles.

`0012_platform_audit` adds `tenant.renamed`, `tenant.suspended`, and `tenant.reactivated`, extends the audit shape check with three empty-object branches, and grants `USAGE` on schema `audit` and `EXECUTE` on `audit.append_entry` to `transferpro_platform`.

## Consequences

- A superadmin who is also a member cannot exist. The triggers enforce both insert orders.
- The platform role cannot read a tenant table even if a query is written later. The catalog test fails closed.
- The tenant audit log is the record of a rename and of the operator lever. List and open leave no audit row.
- The audit row for the lever names the role `transferpro_owner` because the script has no signed-in user.
- A superadmin's session ends after 8 hours. There is no second factor in v1. That is a known risk: a stolen superadmin password is enough until the session ends.
- Rate limiting the platform routes is backlog.

## Alternatives considered

- **Better Auth admin plugin.** It is a global user admin, not a firm directory, and it does not match the column grants.
- **`SECURITY DEFINER` directory functions.** A mistake in one function runs as the owner. A separate role fails closed.
- **A status column on `auth.organization`.** The organization plugin owns that table. A side table keeps the marker out of its writes.
- **A platform audit table.** ADR-0014 already stores the actor as a user id. A second log would split the firm's history.
- **Suspend on the page.** The owner kept v1 to list, open, and rename, and put the lever in an operator script.
- **A member count.** It needs a grant on `auth.member` or a count view. The owner kept the grants narrower.
- **404 for a tenant admin.** The guard answers 403 before lookup, so a tenant admin learns nothing about whether an id exists.
