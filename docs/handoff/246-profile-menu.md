# 246 profile menu

Out of scope: the rest of the Driver header (today's date) is step 12, and clearing the Transfer draft on sign-out is the later draft ticket.

## Decisions

- `/profile` is for a signed-in Tenant member (Admin, Dispatcher, Driver). A Superadmin has no membership, so the page shows the existing no-access alert and does not paint email, role, or Tenant. The platform menu keeps language, theme, and Odjava, and omits Moj profil.
- Member sign-out is `useShellSignOut` only. The Transfer draft is cleared there when that ticket lands. Platform sign-out and invitation accept stay their own paths.
- Language in the menu is `HR | EN` on one row. Theme is `Svijetla | Tamna | Prema uređaju` on the next. Each choice is a menu item, so one click applies it and the arrow keys reach it. Profile page pickers stay small (`size="sm"`) on every layout.
- `/settings` for an Admin opens the Tenant tab. Profile is not a settings tab. `/settings/profile` redirects to `/profile`. A Dispatcher or a Driver who opens `/settings`, `/settings/tenant`, or `/settings/members` lands on `/profile`.

Changed specs, and why:

- `e2e/settings-profile.spec.ts` — `/settings` is company settings for an Admin and `/profile` for the other roles; locale, theme, and Moj profil use `/profile`; the Driver opens profile from the menu; settings tabs are Tvrtka and Članovi; old `/settings/profile` redirects; menu one-click and `@phone` axe cover the page.
- `e2e/fixtures/ui.ts` — `switchLocale` and `switchTheme` open `/profile`; a refused settings address lands on `/profile`; sign-out comment matches the menu for the Driver.
- `e2e/driver.spec.ts` — Driver Home has the menu trigger, not a Postavke link; settings redirects do not show the settings tabs.
- `e2e/office-roles.spec.ts` — a Dispatcher sent away from Tenant settings or Members has no settings tabs.
- `e2e/office-shell.spec.ts` — the menu shows `HR` / `EN` and the theme row; the language row is reachable with the arrow keys.
- `e2e/platform.spec.ts` — Superadmin theme and language are those menu items.
- `e2e/signed-out-pages.spec.ts` — `/profile` is on the signed-out list with `/settings/profile`.

## Code review

Fixed point `origin/develop`, commit `8dfa6ae`. After this review the unused `locale.group` strings were removed. The reports below are the review as it ran.

### Standards

**Hard violations:** none.

Glossary terms stay in code (`tenantName`, roles). Both locales gained the same keys. The menu uses `HR` / `EN` and the existing theme strings. `/profile` is read-only email, role, and Tenant, with Nuxt UI controls. The email field is labeled and `text-base`. Errors use `role="alert"`. The member middleware and the page both require a tenant session.

**Judgement calls**

- **Speculative Generality** — `i18n/locales/en.json` and `hr.json` add `locale.group` (`"Language"` / `"Jezik"`). Nothing calls it. The menu uses `locale.hrShort` and `locale.enShort` only.
- **Duplicated Code** — the Driver header is the same shape in `app/pages/index.vue` and `app/pages/profile.vue`: `class="mb-4 flex items-start justify-between gap-3"` plus `<OfficeUserMenu />`.
- **Duplicated Code** — `ProfileMenu.vue` repeats the mount gate already in `LocaleThemeActions.vue`: `const themeReady = ref(false)` / `onMounted(() => { themeReady.value = true })`.
- **Middle Man** — `app/pages/profile.vue`: `const member = computed(() => session.value)`.
- **Size tension (not a hard breach).** `profile.vue` passes `<LocaleThemeActions size="sm" />` on every layout, including the Driver phone column. ADR-0038 line 51 requires small pickers on `/profile`; the superseded note in the same ADR says phone layouts use size `xl`. The screen-specific sentence governs.

### Spec

## (a) Missing or partial

**Handoff.** “Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; the handoff flags each changed spec and why.” The specs are rewritten (`e2e/settings-profile.spec.ts`, `e2e/driver.spec.ts`, `e2e/office-roles.spec.ts`, `e2e/office-shell.spec.ts`, `e2e/platform.spec.ts`, `e2e/signed-out-pages.spec.ts`, `e2e/fixtures/ui.ts`). There is no `docs/handoff/246-*.md` in the diff, so nothing flags those files or why.

## (b) Scope creep

None. Admin `/settings` now opens the Tenant tab, and the profile tab is gone, which matches “`/settings` is the Tenant's settings and is Admin only.” Unused `locale.group` strings are not user-facing behaviour.

## (c) Implemented, but wrong

**Superadmin `/profile`.** “`/profile` opens for every role and enforces a signed-in member itself” and “`/profile` is for every role, the Driver included. It shows the email (read only), the role, and the Tenant.” The same acceptance list includes Superadmin for the menu (“for Admin, Dispatcher, Driver, and Superadmin”). `member` middleware treats a 403 as `unavailable` and stays; `profile.vue` then shows `shell.noAccess` and hides the email, role, and Tenant. The new spec locks that in: “a superadmin who opens /profile does not see a member profile.” A signed-out visitor is sent to sign-in, which matches the member check. A signed-in Superadmin does not get the profile the spec describes.
