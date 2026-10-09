# 122 Settings admin tabs

Out of scope: the audit page (#123), moving Locale and theme off the signed-in pages (#124), the Home dashboard (#115), agent rules (#114), and server allow-lists.

## Decisions

- `/settings/tenant` and `/settings/members` declare the shared `admin` middleware. A Dispatcher or a Driver is sent to `/settings/profile`. Any other admin address, including the later `/audit` page, is sent Home. Do not copy a second admin check into a new route; declare this middleware.
- The middleware returns without redirecting when the session read is unavailable. Each of these pages still leaves for Profile when its own session read is not an Admin, and it does not mount the form unless `session.role === 'admin'`.
- The tab menu lists Profile for every Tenant role. Tenant (`shell.tenant`) and Members (`members.title`) are Admin only, each with `exact: true`.
- Tenant keeps `TenantSettings`. Members keeps `MemberInvite` and `MemberList`, including the confirmation and the errors. A Dispatcher has no read-only Member list.
- Home keeps the example instant, expiring documents, and the audit log. Do not put Tenant settings, Members, or invitations back on Home.
- Locale and theme buttons stay on these pages the same way they stay on the other signed-in pages, until #124. Do not remove them from Home.
- `invite()` opens `/settings/members` through `openMembers()`. Do not look for the invitation form on Home.
- `GET /api/tenant-settings` stays readable by every Tenant role. `GET /api/members` authorization is unchanged. No server test changes.

## Code review

Two passes, fixed point `origin/develop`. Pass 1's hardcoded `is-admin` was replaced with the session role, and a non-admin session leaves for Profile before the form mounts. Pass 2 matches this branch.

### Pass 1

## Standards

### Hard

`app/pages/settings/members.vue` and `app/pages/settings/tenant.vue` render tenant data and then ignore the role on the session they already loaded:

```29:31:app/pages/settings/members.vue
    <MemberList
      :is-admin="true"
      :current-user-id="session.userId"
```

```29:31:app/pages/settings/tenant.vue
    <TenantSettings
      :is-admin="true"
      @saved="refresh()"
```

`AGENTS.md` (Security): every route or loader that returns tenant data enforces the role allow-list itself, and does not rely on the caller. `app/middleware/admin.ts` returns without redirecting when the lookup is `unavailable`. Office pages cover that gap (`useSessionShell` sends a Driver home if the middleware read failed and the page read succeeded). These pages do not. `drivers.vue` passes `session.role === 'admin'`. A later successful shell read can show invite, role change, removal, and the settings form to a non-admin.

### Judgement calls

**Duplicated code.** `members.vue` and `tenant.vue` repeat the same screen chrome: `h1.mb-4.text-2xl`, the `shellError` `UAlert`, and `LocaleThemeActions`. `settings/profile.vue` already uses that chrome, so this matches the local page pattern.

**Speculative generality.** No current route hits the non-settings branch:

```4:5:app/middleware/admin.ts
 * Tenant settings and Members go to Profile, and any other admin address
 * goes Home. Audit will use that Home branch.
```

```16:16:app/middleware/admin.ts
  const denied = isSettingsAdminPath(to.path) ? '/settings/profile' : '/'
```

Those two paths are also listed again on the settings tabs.

## Spec

### (a) Missing or partial
None.

### (b) Scope creep
None.

### (c) Implemented but wrong
None.

### Pass 2

## Standards

### Hard

None. The pass 1 finding is closed.

`app/pages/settings/members.vue` and `app/pages/settings/tenant.vue` no longer pass `:is-admin="true"`. Each page reads the shell itself and leaves before the form mounts when the role is not admin, including when `app/middleware/admin.ts` returns on `unavailable`:

```21:22:app/pages/settings/members.vue
if (session.value && session.value.role !== 'admin')
  await navigateTo('/settings/profile', { replace: true })
```

The template is `v-if="session?.role === 'admin'"`, and `:is-admin` is `session.role === 'admin'`. `tenant.vue` does the same. That matches AGENTS.md Security: the route enforces the allow-list itself and does not rely on the middleware. Tabs in `app/pages/settings.vue` hide those links unless `session.role === 'admin'`. Copy uses existing `shell.tenant` and `members.title` keys in both locales. Icons are `i-lucide-building-2` and `i-lucide-users` from the installed Lucide set. No new palette colors, formatters, or cross-module imports (ADR-0016, ADR-0018, working rules on i18n and theme).

### Judgement calls

**Duplicated Code** (kept). `members.vue` and `tenant.vue` repeat the same page shell: the admin redirect, `h1`, error `UAlert`, and `LocaleThemeActions`. The role check should stay on each route (AGENTS.md). The chrome already matches `profile.vue` and the office pages, so a shared wrapper is optional.

**Speculative Generality** (dropped). The middleware Home branch is the deny default for any admin path other than `/settings/tenant` and `/settings/members`. The sentence "Audit will use that Home branch" is a comment on that default, not an unused hook.

## Spec

### (a) Missing or partial
None

### (b) Scope creep
None

### (c) Implemented but wrong
None
