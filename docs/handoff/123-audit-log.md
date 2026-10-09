# 123 Audit log

Out of scope: the Home dashboard cards (#115), moving Locale and theme off the signed-in pages (#124), the Dispatcher 403 server test for `GET /api/audit-entries` (#118), and agent rules (#114).

## Decisions

- `/audit` declares the shared `admin` middleware and `layout: 'dashboard'`. A Dispatcher or a Driver is sent Home. A signed-out visitor gets the sign-in form. Do not send them to Profile.
- The middleware returns without redirecting when its session read is unavailable. This page then leaves for Home when its own session read is not an Admin, before `AuditLog` mounts. That is the middleware's Home branch, not a second policy.
- The sidebar lists Audit for an Admin only, with `t('audit.title')`, `exact: true`, immediately before Settings. A Dispatcher does not get the item. The role comes from the layout's server session read, then from the shared `session-shell` entry after a client sign-in.
- The log loads when Audit opens (`onMounted`). It does not live-update from another route. Leave the generation watch: a change on the same page still reloads. Refresh stays.
- Home no longer mounts `AuditLog`. It still shows the example instant and expiring documents. Do not add a card grid.
- Later specs open the log with `openAudit()` in `e2e/fixtures/ui.ts`. `e2e/audit.spec.ts` clicks the sidebar item itself.
- Do not change how entries are written, their shape, or who may call `GET /api/audit-entries`. Locale and theme buttons stay on this page until #124.

## Code review

Two passes, fixed point `origin/develop`. Pass 1's blank `/audit` when the middleware read was unavailable, the copied audit-link click, and `officeNavRole` were fixed before pass 2. Pass 2 matches this branch.

### Pass 1

## Standards

Fixed point: `5da1e9953a15d169622a7cdc66c55436e406b6af` (`origin/develop`). Diff: `git diff origin/develop...HEAD`. Commits: `ee9511b feat(audit): move the audit log to /audit`.

### Documented standards

No hard violations.

**Judgement call, `AGENTS.md`** (“Every route and every loader or helper that returns tenant data enforces the role allow-list itself; do not rely on the caller.”). `app/pages/audit.vue` says the admin middleware is the only gate and not to add a second check, then only hides the log:

```54:54:app/pages/audit.vue
    <section v-else-if="session?.role === 'admin'">
```

`app/middleware/admin.ts` returns without redirecting when the lookup is `unavailable`. `app/pages/settings/members.vue` and `tenant.vue` then `navigateTo` if that page’s own session read is not an admin. This page does not, so a failed middleware read can leave a non-admin on a blank `/audit`. The `v-else-if` still stops `AuditLog` from calling the audit endpoint, so this is not a hard breach.

Checked and in line: vertical `UNavigationMenu` with route `to` (component-selection, Navigation); `UTable` unchanged; `audit.title` already in both locale files (`working-rules.md`, i18n); the page `h1` is not a navbar title (`docs/adr/0016-nuxt-ui.md`); `i-lucide-scroll-text` is in the installed Lucide set. No new audit action, so the audit-log write rules do not apply.

### Baseline smells (judgement)

**Duplicated Code.** The same navigation chain is copied in `e2e/clients.spec.ts`, `drivers.spec.ts`, `locations.spec.ts`, `vehicles.spec.ts`, `roster.spec.ts`, and `ride-assign.spec.ts`:

`page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Revizijski zapisnik', exact: true }).click()`

**Duplicated Code.** `officeNavRole` in `app/layouts/dashboard.vue` repeats `isOfficeMember` in `app/composables/session-shell.ts` (`role === 'admin' || role === 'dispatcher'`).

The `audit.vue` load-error, tenant line, and locale actions match `clients.vue`. That copy is the existing office-page pattern, so it is not counted.

## Spec

### (a)

None.

### (b)

None.

### (c)

`/audit` declares the shared `admin` middleware, so a Dispatcher or a Driver is sent Home when that read succeeds. The page also gates the log:

```54:54:app/pages/audit.vue
    <section v-else-if="session?.role === 'admin'">
```

That is a second admin check. The spec says: "Do not copy a second admin check." `useSessionShell()` is called without the office redirect. The middleware returns without redirecting when its session read is unavailable. If the page read then finds a Dispatcher or a Driver, they stay on a blank `/audit`. "A Dispatcher or a Driver who opens `/audit` is sent Home before the page loads" does not hold in that case. The gate only skips `AuditLog`, so `GET /api/audit-entries` is not sent, and the visitor is not sent Home.

### Pass 2

## Standards

HEAD `5550774c5052d23eaed6378cb4239e4c826e796a`. Fixed point `origin/develop` is `5da1e9953a15d169622a7cdc66c55436e406b6af`. Diff: `git diff origin/develop...HEAD` (includes `5550774` and `ee9511b`).

### Pass 1

1. **Closed.** `app/pages/audit.vue` now leaves before the log mounts when its own read finds a non-admin:

```28:29:app/pages/audit.vue
if (session.value && session.value.role !== 'admin')
  await navigateTo('/', { replace: true })
```

`v-else-if="session?.role === 'admin'"` still keeps `AuditLog` from requesting `/api/audit-entries`. That route already returns 403 for a non-admin (`server/api/audit-entries.get.ts`). A null session still does not `navigateTo`; the log stays unmounted. Not an allow-list breach (`AGENTS.md`).

2. **Closed.** The six specs call `openAudit` in `e2e/fixtures/ui.ts`. `settings.spec.ts` and `accept-by-phone.spec.ts` use `page.goto('/audit')`, a different path.

3. **Closed.** `app/layouts/dashboard.vue` assigns through `isOfficeMember` on both the server read and the client shell watch. No second office-role predicate.

### (a) Documented-standard breaches

None. The Audit item is a `to` link on the existing vertical `UNavigationMenu` (component-selection, Navigation). Copy is `t('audit.title')` in both locales. The page keeps `LocaleThemeActions`, Nuxt UI alerts with `role="alert"`, and an `xl` sign-out button (`docs/agents/working-rules.md`, i18n and theme; ADR-0016). No new audit-entry fields, no deep module import, no server import from `app/` (`CHARTER.md` layout; ADR-0018).

### (b) Baseline smells

**Duplicated Code** (judgement call). `e2e/audit.spec.ts` repeats `openAudit`:

```27:29:e2e/audit.spec.ts
  await nav.getByRole('link', { name: 'Revizijski zapisnik', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()
```

against

```102:105:e2e/fixtures/ui.ts
export async function openAudit(page: Page) {
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Revizijski zapisnik', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()
```

## Spec

### (a) Missing or partial
None.

### (b) Scope creep
None.

### (c) Implemented but wrong
None. Pass 1 (c) is closed.

`/audit` declares `middleware: 'admin'`. A non-admin page session is sent Home with `navigateTo('/', { replace: true })` before `AuditLog` mounts, the same Home branch as the middleware for any admin address other than Tenant and Members. The `v-if="session?.role === 'admin'"` only keeps the log from mounting, so a Dispatcher or Driver whose middleware read was unavailable does not stay on a blank `/audit` and does not call `GET /api/audit-entries`. That matches the handoff: do not copy a second policy, and still leave when the page’s own session read is not an Admin.

An Admin gets the sidebar item, newest-first rows (the existing list order), and Refresh. A settings save and a member role change show up after opening `/audit`. A Dispatcher has no item. A Dispatcher or Driver opening `/audit` is sent Home with no audit request. A signed-out visit shows the sign-in form. Home no longer mounts the log and still shows the example instant and expiring documents, with no card grid. The listed e2e files cover that, and the other e2e edits only move existing log assertions onto `/audit` so the suite can pass. Writes, entry shape, settings, members, locale, theme, and who may call the audit endpoint are unchanged.
