# 244 Theme tokens and phone axe base

Out of scope: the office frame (grouped sidebar, phone bottom bar, sign-in card), steps 11–12 screens, `adr` surfaces, the 40 px row, and a density or shade picker.

## Decisions

- Lift-36 dark surfaces are frame `#070d18`, working `#10192a`, panel `#1c283c`, hover `#263246`. Light surfaces stay the ADR-0040 start: frame `#e8eef5`, working `#f8fafc`, panel `#ffffff`, hover `#e2e8f0`. The hexes live in `shared/theme-contrast.ts` and are copied into `app/assets/css/main.css`. Change both together.
- Light structural borders have no 2:1 rule. Their table minimum is 1, which cannot fail. The measured-ratio test locks them. Dark structural minimum is 2.
- The contrast test names every pair. Dropping a surface or a badge fails even when the remaining ratios pass.
- Theme choice is `light`, `dark`, or `system` under `transferpro-theme`, default `system`. The existing pickers (`LocaleThemeActions`) offer Svijetla, Tamna, and Prema uređaju. The office profile menu does not yet. ADR-0040 also puts the choice there; that lands with the frame, not by adding items to today's two-item menu.
- `--tp-row` and `THEME_ROW_PX` are 36. Table rows use that as a minimum height. An `xl` control can still make a row taller. Do not add 40 px.
- Light primary buttons are blue-600 `#2563eb` with white text (5.17:1). Dark keeps blue-500 `#3b82f6` because the inverted label is slate-900 (4.85:1). blue-500 with white text is 3.68:1.
- Badge hexes in the contrast table are what step 11 paints. They are not on screen yet.
- `html lang` follows the page locale.
- `UTable` root is `overflow-visible`. The focusable wrapper around the table is the scroll container.
- The phone Playwright project greps `@phone` (Chromium, 390×844, touch). The desktop project still runs every spec, including `@phone`.
- Ride-state badges, the profile-menu theme control, and small (non-`xl`) pickers on desktop are not this ticket.

## Specs changed

- `e2e/theme-pages.spec.ts` — axe (WCAG 2.2 AA tags) in both themes and both locales; tagged `@phone`; the phone sidebar opens before the nav link. The old usability checks stay.
- `e2e/settings-profile.spec.ts` — button names are Svijetla, Tamna, Prema uređaju (en Light, Dark, Follow the device). After Tamna or Svijetla, Prema uređaju follows `emulateMedia` again.
- `e2e/platform.spec.ts` — same theme labels.
- `e2e/office-home.spec.ts` — Home still has no theme buttons, under the new names.
- `e2e/fixtures/ui.ts` — `switchTheme` clicks the new labels and accepts `system`.

## Code review

Fixed point `origin/develop`, uncommitted. After this review the pair list is exhaustive, table rows use `--tp-row`, the transfer-day plate and the roster select are monospace, and the light-structural comment matches the 1:1 minimum. The reports below are the review as it ran.

## Standards

Uncommitted work on `feature/244-theme-tokens` against `origin/develop` (`git log` empty). Three hard breaches, three judgement calls.

### Hard

**`app/assets/css/main.css` vs `shared/theme-contrast.ts` — ADR-0040, Contrast rules.** The ADR says a unit test computes every token pair and fails when a pair drops below its rule, so a palette change cannot ship quietly. The hexes are copied by hand (“Hexes match shared/theme-contrast.ts”). The test never reads the CSS. Dark primary is the clearest split: the test locks slate-900 `#0f172a` on `#3b82f6`, while CSS only sets `--ui-primary: #3b82f6` and never sets that label colour. The comment in the same file says white on blue-500 is 3.68:1, under the 4.5:1 text rule.

**Theme placement — ADR-0040, Theme choice; ADR-0038, Profile menu.** The choice must sit in the profile menu, on the profile page, and on sign-in. `LocaleThemeActions.vue` is the only control (sign-in, profile, invite, platform). `OfficeUserMenu.vue` is untouched. `e2e/office-home.spec.ts` still expects `Svijetla`, `Tamna`, and `Prema uređaju` to be absent on Home.

**`app/components/LocaleThemeActions.vue` — ADR-0038, Superseded.** “Size `xl` now applies only to the phone layouts.” The new theme buttons are `size="xl"` on desktop sign-in and profile. Those screens ask for small pickers (ADR-0038, Sign-in and Profile menu).

Locales, `neutral: 'slate'`, `primary: 'blue'`, radius `0.375rem`, `transferpro-theme` still in `nuxt.config.ts`, and an extended e2e spec match working-rules (i18n and theme) and AGENTS.md. ADR-0018 does not apply: no catalog module boundary is crossed.

### Judgement

**`shared/theme-contrast.ts` — the file’s own rule, not ADR-0040.** Light structural pairs use `minimum: 1` and fail only when `contrastRatio < minimum`. Equal colours are exactly 1, so a missing light border passes. The comment says a missing border still fails.

**Speculative Generality.** `--tp-row: 36px` and exported `THEME_ROW_PX` are locked by a test and unused by any layout.

**Duplicated Code — `e2e/theme-pages.spec.ts`.** Five tests repeat the same shape: seed, `useTheme`, sign-in, `openOfficeLink`, axe, `switchLocale`, axe. `openOfficeLink` is the only shared piece.

## Spec

### (a) Missing or partial

- **Handoff.** “Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; the handoff flags each changed spec and why.” `theme-pages`, `settings-profile`, `platform`, and `office-home` are rewritten. There is no `docs/handoff/` file for #244.
- **36 px row.** Owner: “Zadano je lift-36: … visina retka 36 px.” `--tp-row` and `THEME_ROW_PX` are 36 and unused. No row is 36 px.
- **Theme-and-axe fixture.** “A shared fixture that runs a screen in light and dark and runs axe with WCAG 2.2 AA tags.” `expectNoAxeViolations` only runs axe. The theme spec still loops both themes, and that spec is tagged `@phone`, so desktop and phone both run it.
- **Monospace plates.** “monospace for plates and flight numbers”. Driver, office home, and the vehicle list use `font-mono`. The Transfers day vehicle label and the roster plate do not.

### (b) Scope creep

- Every `UTable` root is `overflow-visible` so a wrapping region can take the scroll. #244 does not ask for a table-scroll change.

### (c) Implemented but wrong

- **Coverage can shrink.** “The contrast table covers every text, control-boundary, structural-border, and badge pair in both themes and fails when a pair drops below its rule.” `themeContrastPairs()` lists those pairs and `themeContrastFailures()` must be empty, but the test only checks that `some` pair of each kind exists. Dropping a surface or a badge still passes.
- **Light structural rows cannot fail.** Same line. Light structural `minimum` is 1 and the check is `ratio < minimum`. Contrast is never below 1, so an identical border and surface (ratio 1) passes. ADR-0040’s 2:1 rule is dark-only; the code comment still says a missing light border fails.
