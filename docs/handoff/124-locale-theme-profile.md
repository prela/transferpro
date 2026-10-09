# 124 Locale and theme on Profile

Out of scope: platform locale and theme, the invitation accept screen's controls, `POST /api/locale`, `transferpro-theme`, the session-shell shape, sign-out clearing only the session shell, and agent rules (#114).

## Decisions

- Locale and theme for a signed-in Member stay on Profile. Do not put those buttons back on signed-in Home, the office pages, Audit, or the Tenant and Members tabs. The sign-in screen keeps both.
- An office or Driver journey that needs another Locale calls `switchLocale` in `e2e/fixtures/ui.ts`. It saves on Profile through `POST /api/locale` and returns to the screen under test. Wait until that screen's URL is current before calling it.
- Theme on those journeys uses `switchTheme`. `useTheme` installs an init script that would put the old value back on the next document, so `switchTheme` registers the clicked value after it.
- An alert that exists only on the current page does not survive that round-trip. Produce it again after the Profile save if the spec still needs the sentence.
- The sidebar journey in `e2e/office-shell.spec.ts` uses the same helpers. Signed-in Home no longer has the buttons.

## Code review

Two passes, fixed point `origin/develop`. Pass 1's glossary comment and the copied hydration wait were fixed before pass 2. Pass 2 matches this branch.

### Pass 1

## Standards

Fixed point `origin/develop` (`2879cbd908f6e558ea041b85edb343c00f10fc8b`) resolves. Diff is non-empty: `d954378`, 28 files.

### Documented standards

**GLOSSARY.md (Locale, avoid “language”); AGENTS.md (use glossary terms in code and tests).** `e2e/settings-profile.spec.ts` adds `/** Locale and theme buttons, in either language. */`. That comment should say locale. Documented breach, small.

No breach of `docs/agents/working-rules.md` (i18n and theme): no new copy, both locales and both themes stay on Profile and sign-in, `transferpro-theme` is unchanged, and screens stay Nuxt UI. `CHARTER.md` (UI and session), ADR-0016, and ADR-0018: no second UI library, no cross-module import, sign-in still keeps the controls. Page edits only drop `LocaleThemeActions` from signed-in screens.

### Smells (judgement)

**Duplicated Code.** `hydrated` is copied into `e2e/fixtures/ui.ts` while `e2e/settings-profile.spec.ts` keeps the same function:

```ts
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt')
    const app = root ? Reflect.get(root, '__vue_app__') : undefined
    const nuxt = app?.config?.globalProperties?.$nuxt
    return nuxt?.isHydrating === false
  })
}
```

Export one and call it from the spec.

**Duplicated Code.** `switchLocale` and `switchTheme` repeat the profile trip (`goto('/settings/profile')`, heading, `hydrated`, return unless already there). `saveEnglishOnProfile` / `saveDarkOnProfile` repeat that click path, and the new role test pastes the admin reset twice:

```ts
await page.goto('/settings/profile')
await hydrated(page)
await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
// ...
await page.getByRole('button', { name: 'Svijetla tema', exact: true }).click()
```

One helper for the round-trip; the spec should call `switchLocale` / `switchTheme`. The spec copies also skip the fixture’s `POST /api/locale` wait.

Removing `LocaleThemeActions` from many pages is the consolidation this change is for, not a new scatter. No other baseline smell.

## Spec

Fixed point `origin/develop` is `2879cbd908f6e558ea041b85edb343c00f10fc8b`. The diff is one commit, `d954378`, and is non-empty.

(a) Missing or partial: none. Locale and theme controls are gone from signed-in Home, the office pages (clients, locations, drivers, vehicles, transfers, roster, audit), and the Tenant and Members tabs. Profile still changes both. A Profile locale save still uses `POST /api/locale`, and the following Clients or Driver Home screen uses that language. Admin, Dispatcher, and Driver are covered. Sign-in still has both controls. Sign-out still returns to Croatian and leaves `transferpro-theme` in place. Platform and invitation-accept screens are untouched. `switchLocale` is in `e2e/fixtures/ui.ts`. The listed specs route signed-in toggles through Profile. `e2e/platform.spec.ts` and `e2e/accept-invite-invalid.spec.ts` still use the on-page controls. No server tests, session-shell, `POST /api/locale`, or agent-rule files changed.

(b) Scope creep: none. `switchTheme` and the `e2e/office-shell.spec.ts` update are the theme and sidebar journeys the spec told to move onto Profile. Form re-entry after that round-trip only restores fields the navigation clears.

(c) Implemented but wrong: none. The Driver conflict spec re-arms the Ride because the alert does not survive the Profile trip, then checks the English failure on the reloaded screen. That matches "switch on Profile first, then show the office screen in the saved language."

### Pass 2

## Standards

Fixed point `origin/develop` (`2879cbd`) resolves. `git diff origin/develop...HEAD` is non-empty: `d954378`, `bdc424b` (28 files).

### Documented standards

No breaches. The pass 1 comment now says “either locale” (`e2e/settings-profile.spec.ts`). New comments and helpers use Locale, Member, and Profile (`GLOSSARY.md` Locale, avoid “language”; `AGENTS.md`: those terms in code and tests). `switchTheme` writes only `light` or `dark` under `transferpro-theme` (ADR-0016; `docs/agents/working-rules.md`, i18n and theme). Signed-in pages drop `LocaleThemeActions` and stay on Nuxt UI. No ADR-0018 boundary change.

### Judgement calls

**Duplicated Code.** `switchLocale` and `switchTheme` in `e2e/fixtures/ui.ts` still share the profile trip:

```44:58:e2e/fixtures/ui.ts
export async function switchLocale(page: Page, locale: 'hr' | 'en') {
  const returnTo = page.url()
  await page.goto('/settings/profile')
  await expect(page.getByRole('heading', { level: 1, name: /^(Profil|Profile)$/ })).toBeVisible()
  await hydrated(page)
  // ...click, then:
  if (new URL(returnTo).pathname !== '/settings/profile')
    await page.goto(returnTo)
}
```

`switchTheme` (`e2e/fixtures/ui.ts` lines 65–81) repeats that frame. The click and the theme init script differ.

**Duplicated Code.** The role test pastes the same office journey for admin and dispatcher:

```96:121:e2e/settings-profile.spec.ts
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  await page.goto('/clients')
  // ...dark, then hr + light, signOut
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await switchLocale(page, 'en')
  await page.goto('/clients')
  // same sequence through signOut
```

The driver path (My rides, no reset) differs.

Pass 1’s other two items are gone: `hydrated` lives only in `e2e/fixtures/ui.ts`, and the role test’s reset calls `switchLocale` / `switchTheme`.

## Spec

(a) none.

(b) none.

(c) none.

Signed-in Home, the office pages, and the Tenant and Members tabs no longer render locale or theme controls. Profile and the signed-out sign-in form still do. Platform pages and the invitation accept screen are unchanged. `switchLocale` saves through `POST /api/locale` and returns to the screen under test. The role journey covers an Admin, a Dispatcher, and a Driver, including the next office or Driver screen. `office-shell.spec.ts` and `switchTheme` are that same Profile round-trip for journeys that used to toggle on the office page. The later commit only shares those helpers.
