# 245 Office frame

Out of scope: Podizvođači, Cjenik, Računi, the urgent-count value, the ride detail, and the Driver frame.

## Decisions

- `git switch develop` is refused by the shell guard. This branch is `feature/245-office-frame-6ad6` from `origin/develop` (`8de95d9`).
- The signed-in session shell and the platform shell carry `userName` and `email` for the current account only, so the menu can show initials and the address. The members list still omits email. Logs and audit do not receive either field.
- The platform menu has locale, theme, and sign-out. It has no Moj profil: a superadmin has no tenant session, and `/settings` would 403.
- English catalog nav stays "Clients". Croatian nav and the screen title are Naručitelji. Form and audit sentences that still say klijent were not rewritten.
- Sign-in language and theme pickers stay `sm` on every viewport. Profile pickers are `sm` from `lg` up and `xl` with `min-h-11` below it. The hide is on a wrapper, because the actions root is `display: contents`.
- Frame desktop controls are `sm`. The phone bar, Više, the floating button, and phone menu items are at least 44 px. Firm-list and rename controls stay `xl`; they are page controls, not the frame.
- The urgent-count slot is `urgentCount: null`. The sidebar omits the badge. The phone Početna button renders a count only when the value is a number.
- Sidebar company settings goes to `/settings/tenant`. Its screen title is Postavke tvrtke / Company settings. The settings tab stays Tvrtka / Company.
- The platform list title is Tvrtke / Companies. Audit action sentences that say "firm" were not rewritten.
- Office and platform share `localStorage` key `transferpro-dashboard`.
- The phone bar uses `--tp-frame`, the same surface as the sidebar.

## Specs changed

- `e2e/office-shell.spec.ts` — grouped links, Početna as the only h1, phone bar and Više, menu theme and locale, `@phone` axe in light and dark and once in English.
- `e2e/theme-pages.spec.ts` — catalogs open from the sidebar, or from Više when that link is hidden.
- `e2e/platform.spec.ts` — one link, Tvrtke; English Companies; theme and locale from the menu. Email absence is scoped to `main`.
- `e2e/settings-profile.spec.ts` — tabs Profil / Tvrtka / Članovi; Moj profil opens profile; home has no page-level theme buttons; tenant screen title is Postavke tvrtke.
- `e2e/settings.spec.ts` — company settings opens from Postavke tvrtke, then the Tvrtka tab.
- `e2e/fixtures/ui.ts` — sign-in accepts Početna or the driver tenant heading; audit opens from Revizija; the log heading stays Revizijski zapisnik.
- `e2e/audit.spec.ts`, `e2e/office-roles.spec.ts` — dispatcher has no Revizija and no Postavke tvrtke.
- `e2e/auth.spec.ts`, `e2e/accept-invite-existing.spec.ts`, `e2e/catalog-empty-validation.spec.ts` — office home heading is Početna.
- `e2e/correct-transfer.spec.ts`, `e2e/day-list-accept-by-phone.spec.ts` — the English nav link is Audit; the log heading stays Audit log.
- `e2e/driver-rides.spec.ts` — a phone-width admin sees Transferi on the bottom bar. There is no sidebar slideover.
- `e2e/clients.spec.ts`, `e2e/drivers.spec.ts`, `e2e/locations.spec.ts`, `e2e/vehicles.spec.ts`, `e2e/vehicles-hardening.spec.ts`, `e2e/transfers.spec.ts`, `e2e/roster.spec.ts`, `e2e/driver.spec.ts`, `e2e/signed-out-pages.spec.ts` — tenant line and Klijenti replaced with the menu button and Naručitelji. Empty-state sentences that say klijent stay.

## Code review

Fixed point `origin/develop`, commit `3cad2ba`. After this review the phone Početna button keeps a count slot, the profile pickers hide on a wrapper, the company-settings title is Postavke tvrtke, the platform English title is Companies, and the phone bar uses `--tp-frame`. The reports below are the review as it ran.

## Standards

### Documented standards

**Judgement — ADR-0040 (Colours and surfaces).** `app/components/AppFrame.vue` paints the sidebar with `--tp-frame` and the panel with `--tp-working`, but the new phone bar uses Nuxt `bg-default` / `border-default` (`--ui-bg`, the working surface). The bar therefore sits on the same surface as the panel body instead of the frame token.

**Judgement — ADR-0038 (Profile menu and settings).** New targets are `/settings/profile` and `/settings/tenant` (`ProfileMenu.vue`, `shared/office-nav.ts`). The ADR names `/profile` and `/settings`. Language and theme are separate menu rows (`Hrvatski` / `English`, and the three theme labels), not the `HR | EN` and `Svijetla | Tamna | Prema uređaju` one-click controls the ADR describes.

**Minor — GLOSSARY.md (Tenant, avoid “firm”) and AGENTS.md (“use those terms in code”).** New comment in `server/modules/platform/infrastructure/directory.ts`: “Not a firm field.”

No i18n gap: new shell and audit strings are in both `en.json` and `hr.json`. Platform logging still records `userId` only. `readAccountIdentity` is exported from `server/modules/tenancy/index.ts`. Shotgun `bindScreenTitle` edits are required by ADR-0038 (“the page body does not repeat the title”) and are not counted as a smell.

### Baseline smells (judgement)

**Duplicated Code.** Locale save is copied. `ProfileMenu.vue` `pickLocale` posts `/api/locale`, refreshes `sessionShellKey`, and sets the locale. `app/composables/session-shell.ts` `chooseLocale` does the same with `refresh()` and `setLocale(session.value?.locale ?? next)`.

**Duplicated Code.** `app/pages/settings/profile.vue` mounts two `LocaleThemeActions` (`hidden lg:contents` at `sm`, `contents lg:hidden` at `xl`) so one control can have two sizes.

**Middle Man.** `OfficeUserMenu.vue` only reads the shell and forwards props into `ProfileMenu`.

**Duplicated Code.** `FrameLink` / `FrameGroup` in `AppFrame.vue` repeat `OfficeNavLink` / `OfficeNavGroup`, and `dashboard.vue` `toFrameLink` copies `label`, `to`, `icon`, `exact`, and `urgentCount` across that seam.

## Spec

### (a) Missing or partial

- The phone bottom bar does not leave the urgent-count slot. The issue says "The urgent count on Početna arrives with the Home ticket; this ticket leaves its slot," and ADR-0038 says the bar "holds Početna (with the count)." `urgentCount` is passed only into the sidebar badge. The phone `UButton` list never reads it, so the Home ticket cannot fill the phone slot without another frame change.
- English labels for the Superadmin frame do not follow ADR-0038. The acceptance says "Croatian and English labels follow ADR-0038," and the ADR says Tenant replaces "firm" with "Company." The new platform frame uses `platform.title`, which is still "Firms" (also "No firms yet.", "That firm was not found."). Croatian "Tvrtke" is right.
- Client labels are only partly renamed. The ADR says Client is "Naručitelj" / "Naručitelji." The nav and screen title are "Naručitelji," but the same screen still says "Dodaj klijenta" and "Još nema klijenata.", and transfer copy still says "Klijent."

### (b) Scope creep

None. The session and platform shells now carry the account name and email because the menu must show initials and email. The "+ Novi transfer" nonce only opens the existing transfer form.

### (c) Implemented but wrong

- Phone theme targets can stay under 44px. The owner comment says "xl only on phone layouts; desktop pickers are small," and the acceptance says "phone targets are at least 44 px." The profile page mounts two `LocaleThemeActions` and hides one with `hidden` / `lg:hidden`. The component root is already `class="contents"`, so the phone root has two unprefixed `display` utilities. Tailwind picks the stylesheet winner, not the class order, so the small set is not reliably hidden beside the `xl` set.
- The company-settings screen title is the tenant noun, not the settings name. The issue's top bar is "the screen title," and ADR-0038 says those settings are "Postavke tvrtke" (en "Company settings"). The nav item is right, but `bindScreenTitle` and the settings tab use `shell.tenant` ("Tvrtka" / "Company").
