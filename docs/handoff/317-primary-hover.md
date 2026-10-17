# 317 solid primary hover contrast

Out of scope: other button variants. Disabled opacity stays as it is.

## Decisions

- Solid primary hover and active are Tailwind `primary-600` (`#155dfc`) with `--tp-on-primary` (`#ffffff`). White on that shade is 5.25:1 in both themes. The default `bg-primary/75` wash is what failed 4.5:1.
- Dark rest stays `text-inverted` (slate-900) on blue-500 (`#3b82f6`, 4.85:1). Slate-900 on `primary-600` is 3.4:1, so the hover and active label is `--tp-on-primary`, not `text-inverted`.
- Active uses the same classes. Nuxt UI sets hover and active to the same wash. The issue names hover. Active is that wash on pointer-down.
- The contrast table locks `primary-button-hover` as white on `#155dfc` in both themes. `#155dfc` is the sRGB of Tailwind v4 blue-600 (`oklch(54.6% 0.245 262.881)`), not the resting `--ui-primary` hex.
- The hover axe runs on the sign-in submit (`Prijavi se`) in light and dark, outside `@phone`. The phone project sets `hasTouch` and `isMobile`, so `(hover: none)` and Tailwind `hover:` do not apply there. QC asked for that move after the review below.

## Tests

No test was weakened. No migration.

Fresh `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (617) passed. `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` — 266 passed (3.4m).

## Code review

Fixed point `origin/develop`. The review below is of the uncommitted diff before `--tp-on-primary` replaced `text-white`, and before the hover axe left the `@phone` block.

### Standards

The diff is only the solid primary hover and active contrast change: a button compound variant, a CSS comment, a contrast pair plus its expected name, and a sign-in hover axe test.

#### Hard

**`app/app.config.ts`** — `hover:text-white active:text-white` (and the matching `bg-primary-600` utilities).

- `.agents/skills/nuxt-ui/SKILL.md` core rule 2, and `references/guidelines/design-system.md` (“Semantic colors” / “Semantic utility classes”): semantic utilities only; no raw palette colors. The skill’s own `compoundVariants` example uses `hover:bg-accented`. `text-white` is a raw color; the semantic label token is `text-inverted`.
- ADR-0016 (still in force: ADR-0040 only supersedes the named sentences) and `docs/agents/working-rules.md` (“i18n and theme”): style with Nuxt UI theme tokens. `bg-primary-600` is the Tailwind shade (`--color-blue-600`), not per-theme `--ui-primary` (`#2563eb` / `#3b82f6` in `main.css`).

**`e2e/sign-in-card.spec.ts`** — the new `for (const theme …)` block sits outside `test.describe('@phone')`.

- ADR-0040: axe runs on every phone screen it lists, in both themes. `playwright.config.ts` runs the phone project with `grep: /@phone/`, so this hover axe never runs there. Resting sign-in axe stays inside the `@phone` block.

#### Judgement

**ADR-0040 “own tokens” vs the 4.5:1 rule.** `shared/theme-contrast.ts` uses one pair for both themes (`foreground: '#ffffff', background: '#155dfc'`). “The dark theme has its own tokens, not an inversion of the light ones.” The contrast rule wins on the numbers in the comment (slate-900 on that shade is 3.4:1), so this is not a hard breach.

**ADR-0040 enforcement.** Hover is not a token (`main.css`: “Solid hover is not this token”). The test locks `#155dfc` while the button uses the class `bg-primary-600`. The CSS comment still measures “blue-600” at 5.17:1, which is `--ui-primary: #2563eb`, not the hover blue at 5.25:1. A palette change need not fail the test first. The hardcoded pair matches the file’s existing shape.

**Duplicated code.** The same utilities are written twice:

```18:18:app/app.config.ts
          class: 'hover:bg-primary-600 hover:text-white active:bg-primary-600 active:text-white',
```

The same 4.5:1 / `#155dfc` rationale is copied in `app.config.ts`, `main.css`, and `theme-contrast.ts`. The new spec repeats the `html` dark-class check already in the `@phone` test.

Shotgun surgery is not a finding: ADR-0040 requires the contrast pair and the axe run. No `CHARTER.md` rule applies.

### Spec

#### (a) Missing or partial

None. The solid primary hover is set in `app.config`, and the sign-in form has an axe check while that button is hovered in light and dark.

#### (b) Scope creep

- Spec: "za solid primary postaviti tamniji hover". The compound class also sets `active:bg-primary-600 active:text-white`. Active is the same `bg-primary/75` wash in Nuxt UI, but the spec only names hover. "Ostale varijante gumba, osim ako dijele isti problem" is about other variants, which were left alone.
- Spec: "Dodati axe provjeru s hoverom na primary gumbu". `shared/theme-contrast.ts` also adds a `primary-button-hover` pair (`#ffffff` on `#155dfc`) for both themes, wired through `theme-contrast.test.ts`. That is extra coverage, not the axe check.

#### (c) Implemented but wrong

None. `hover:bg-primary-600` is the example in the spec. It resolves to Tailwind blue-600 `#155dfc` in both themes (`--ui-color-primary-600` → `--color-blue-600`), not the theme `--ui-primary` tokens. White on `#155dfc` is 5.25:1. `hover:text-white` keeps the label white in dark, where the resting label is slate-900. `tailwind-merge` drops `hover:bg-primary/75` when the new class is merged. The new Playwright tests hover "Prijavi se" on `/` and run the existing WCAG 2.2 AA axe helper.
