# 13 — superadmin

Implementation note for issue #13. Delete this file when the ticket merges. ADR-0019 is accepted. Lasting rules are in `AGENTS.md`. Do not edit `CHARTER.md`.

## Owner decisions (Damir, 5.10.2026)

1. No suspend or reactivate UI or API. `pnpm tenant:account --slug <slug> --deactivate` and `--reactivate` are the emergency lever.
2. Platform scope is list, open, and rename. Open shows name, slug, created time, and active. Never tenant data. Rename is audited with empty data. List and open are not.
3. No member count. Platform grants stay the columns in ADR-0019.
4. Catalog tests fail closed: no `SELECT` on any `app` relation, no `DELETE` anywhere.
5. A tenant admin is 403 on platform routes before any id lookup. A superadmin cannot be a member and gets no tenant session.
6. A superadmin session lasts 8 hours. No second factor in v1 is a known risk.
7. Every platform route logs actor user id, action, target tenant id, and outcome. No names and no bodies. Rate limiting is out of scope.

## Callers

Same `/sign-in`. `GET /api/session` stays 403 for a superadmin. Pages `/admin/tenants` and `/admin/tenants/:id` call only `/api/platform/*`. The locale button on those pages is client-side, because `POST /api/locale` opens a tenant session.

```ts
await listTenantAccounts(headers)
await readTenantAccount(headers, rawId)    // 400 bad id, 404 unknown, after the gate
await renameTenantAccount(headers, rawId, body) // { name }
await readPlatformShell(headers)           // { userId, locale, timeZone: 'Europe/Zagreb' }
```

`pnpm superadmin:create --name --email`, `pnpm superadmin:revoke --email`, and `pnpm tenant:account`. Password from the terminal or stdin. `--password` is refused. Routes do not call the scripts. `DATABASE_MIGRATE_URL` stays out of `AppEnv`.

A no-op rename or a repeated deactivate or reactivate writes nothing and appends nothing. Audit actions are `tenant.renamed`, `tenant.suspended`, and `tenant.reactivated`, each with `subjectUserId: null` and `data: {}`. The script stores actor `transferpro_owner`.

## Module map

```
shared/tenant-name.ts
shared/platform-account.ts
server/modules/platform/index.ts
server/api/platform/session.get.ts
server/api/platform/tenants/index.get.ts
server/api/platform/tenants/[id].get.ts
server/api/platform/tenants/[id].patch.ts
app/pages/admin/tenants/index.vue
app/pages/admin/tenants/[id].vue
scripts/superadmin-create.ts
scripts/superadmin-revoke.ts
scripts/tenant-account.ts
db/migrations/0010_platform_superadmin.sql
db/migrations/0011_platform_directory.sql
db/migrations/0012_platform_audit.sql
```

`CompanyAccount` is `id`, `name`, `slug`, `createdAt`, `active`.

## Backlog

- Second factor for a superadmin. v1 has none. A stolen password is enough until the 8-hour session ends.
- Rate limiting on `/api/platform/*`.
