# 121 Settings profile

Out of scope: Tenant and Members tabs, moving Locale and theme off the other signed-in pages (#124), the audit page, the Home dashboard (#115), agent rules (#114), server allow-lists, and the session-shell shape.

## Decisions

- `/settings` is a parent on the `authenticated` middleware. It only redirects. Every Tenant role goes to `/settings/profile`. The index child must not redirect: a child redirect overrides the signed-out redirect to `/`.
- Parent setup redirects the first load. `onBeforeRouteUpdate` returns the same redirect, because a later Settings click keeps the parent mounted.
- The tab menu lists only Profile, with `exact: true`, until Tenant and Members routes exist.
- Locale is the existing `POST /api/locale` through `chooseLocale`. Theme is `transferpro-theme` through `LocaleThemeActions`. Do not add a locale endpoint.
- The dashboard layout applies the saved Locale on the server only, before its template renders. Do not await the session shell in that layout in the browser.
- An Admin and a Dispatcher get Settings in the sidebar (`/settings`, not exact) and in the user menu. A Driver gets a control on Driver Home that opens Profile in the phone column, with no sidebar.
- Leave the existing Locale and theme buttons on signed-in pages until #124.
- Profile does not request Tenant settings writes, Members, invitations, or the audit log. `GET /api/tenant-settings` stays readable by every Tenant role.

## Code review

Two passes, fixed point `origin/develop`. Pass 1's empty `/settings` child on a later Settings click, and the quiet test that cleared requests after Profile was visible, were fixed before pass 2. Pass 2 matches this branch.

### Pass 1

## Standards

Fixed point `origin/develop` is `a90e8e16af9c04250bb6f5631798ad79eb2e0ee1`. Diff is `git diff origin/develop...HEAD` (3 commits).

### Hard

No hard breach. Sign-out stays the shared `POST /api/auth/sign-out` path (working-rules, Sign-in). New copy is `shell.settings` and `shell.profile` in both `i18n/locales/en.json` and `hr.json`; theme stays `transferpro-theme`, and the spec covers light and dark (working-rules, i18n and theme). Screens are Nuxt UI only: `UNavigationMenu`, `UButton`, `UAlert`, `color="neutral"`, tapped buttons `size="xl"`, Lucide icons, driver column `max-w-md` (ADR-0016). Route links use `UNavigationMenu`; `UTabs` is for views that do not need a URL (nuxt-ui component-selection). No `server/` import and no new module (CHARTER layout; ADR-0018). The UI change adds `e2e/settings-profile.spec.ts` and extends the shell specs. No new logs.

### Judgement calls

**Glossary term** (`GLOSSARY.md` Locale, avoid “language”; `AGENTS.md` terms in code). Identifiers stay `locale` / `setLocale`. Comments use the avoided word:

- `app/layouts/dashboard.vue`: “painted in the default language”
- `app/components/OfficeUserMenu.vue`: “Language and theme stay on Profile”
- `app/pages/settings/profile.vue`: “Language uses the existing locale save.”

**Duplicated Code** — `app/pages/settings.vue` repeats the office layout choice already applied in `app/middleware/authenticated.ts` and watched in `app/pages/index.vue`. The page comment says a sidebar jump can drop the middleware call and this layout is not constant, so the extra call matches that constraint. The shape is still copied:

```26:31:app/pages/settings.vue
function applyLayout() {
  setPageLayout(isOfficeMember(session.value?.role) ? 'dashboard' : 'default')
}
applyLayout()
watch(() => session.value?.role, applyLayout)
```

**Message Chain** — `e2e/settings-profile.spec.ts` `hydrated` walks private app state: `#__nuxt` → `__vue_app__` → `config.globalProperties.$nuxt` → `isHydrating`.

## Spec

### (a)

The Profile network check does not cover Profile’s own load. `e2e/settings-profile.spec.ts` records admin requests, then sets `seen.length = 0` after the Profile heading is visible, and only then waits for `networkidle`. A Members, invitation, role, removal, audit, or tenant-settings write started while Profile opens is discarded before the assertion.

Spec: “Add `e2e/settings-profile.spec.ts` for … the absence of those Admin requests on Profile.”

Spec: “A Dispatcher and a Driver on Profile do not request the Admin endpoints above.”

The pages do not call those endpoints. The required test would still pass if they did during setup.

### (b)

None.

### (c)

`/settings` redirects to Profile only in the parent setup (`app/pages/settings.vue`). That setup does not run again while the parent stays mounted. The sidebar and the user menu both point at `/settings`. From Profile, choosing Settings again swaps the child to `app/pages/settings/index.vue`, an empty `<div />`. The URL stays `/settings` and Profile does not open. A fresh `goto('/settings')` still redirects, which is what the tests do.

Spec: “The parent only redirects. Every Tenant role redirects to `/settings/profile`.”

Spec: “`/settings` opens Profile for an Admin, a Dispatcher, and a Driver.”

### Pass 2

## Standards

HEAD is `a963819295d261c9130fee187d2cdff23cde057d`.

### Documented standards

No hard violations.

`docs/agents/working-rules.md` (i18n and theme) and ADR-0016 hold: both locale files, Nuxt UI only, Lucide icons, `role="alert"`, driver column `max-w-md`, theme left on the device. Tapped `UButton`s use `size="xl"`. The settings `UNavigationMenu` has no size prop; `min-h-11` and `text-base` meet the tap-target and 16px rule. Sign-in rules are untouched. ADR-0018: no cross-module import. CHARTER UI/session: `<script setup lang="ts">`, `app/` does not import `server/`. AGENTS.md: e2e specs added and extended. No new logs.

### Baseline (judgement)

**Duplicated Code.** `e2e/settings-profile.spec.ts` copies `expectNarrowColumn` from `e2e/office-shell.spec.ts`:

```
async function expectNarrowColumn(page: Page) {
  const box = await page.locator('main').evaluate((el) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return { rem, width: el.getBoundingClientRect().width }
  })
  expect(box.width).toBeLessThanOrEqual(28 * box.rem + 1)
}
```

**Duplicated Code.** `app/layouts/dashboard.vue` sets the shell locale again. `useSessionShell` already calls `setLocale` when `session.locale` is present:

```
if (import.meta.server) {
  const lookup = await readTenantSession()
  if (lookup.kind === 'member')
    await nuxtApp.runWithContext(() => setLocale(lookup.session.locale))
}
```

The layout comment records why this has to run in the parent, on the server, before the sidebar paints. A shared helper is optional.

**Duplicated Code, suppressed.** `settings.vue` repeats the load-error alert and the `setPageLayout(isOfficeMember(...))` watch from `index.vue`. `clients.vue` uses the same per-page block. Extracting it would be speculative generality against that screen shape.

## Spec

### (a)

None. Both pass-1 gaps are closed in this diff.

The quiet test no longer clears recorded requests after Profile is visible. It waits until Home is idle, then records from `goto('/settings/profile')` through the following `networkidle`. A Members, invitation, role, removal, audit, or tenant-settings write during Profile’s own load stays in `seen` and fails the test. That matches “A Dispatcher and a Driver on Profile do not request the Admin endpoints above.”

Choosing Settings again while the parent stays mounted is guarded. `onBeforeRouteUpdate` (Nuxt’s `beforeEach` for the life of `settings.vue`) sends `/settings` back to `/settings/profile` for a signed-in member. The sidebar and user-menu re-clicks in `e2e/settings-profile.spec.ts` require the Profil heading, not only the URL. That matches “`/settings` opens Profile” and “An Admin and a Dispatcher get Settings in the sidebar and in the user menu.”

Redirect, `POST /api/locale` for `hr` and `en`, the existing failure string, device theme (`transferpro-theme`, no API write), Driver Home control and phone column, signed-out `/settings` and `/settings/profile`, the single Profile item, and the keyboard tab stop are present. The listed e2e files are updated. No server, allow-list, session-shell schema, or Home admin-panel edits.

### (b)

None. The dashboard layout’s server-only `setLocale` is the mechanism for “the following screen uses that language” (sidebar names on the next full load). Locale and theme controls on the existing signed-in pages are still there.

### (c)

None.
