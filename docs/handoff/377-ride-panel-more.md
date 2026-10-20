# 377 Više menu under the ride slideover

Out of scope: navbar hydration warnings, and a phone or dark paint check for Više.

## Decisions

- One `popperZ` of `z-[70]` in `app/app.config.ts` sits on `dropdownMenu`, `select`, `selectMenu`, `inputMenu`, `popover`, and `tooltip`. The Ride slideover is `z-[60]`. Reka copies the class onto the popper wrapper, so the menu paints above the panel.
- Popover and tooltip have no caller inside that slideover. They share `popperZ` so a later one does not fall behind the same panel. The same class also covers Assign, Reassign, and Vehicle, which had no local override.
- The seven local `z-[70]` classes on `TransferFormFields` came off. The global slot is the one place.
- The full e2e flake was not a click before hydration. `openListbox` already waited for that. A create-item click leaves the place list open, Escape focuses its trigger, and an immediate ArrowDown reopens that list instead of Vrsta. The helper now waits until that listbox node is out of the document, then takes a fresh handle. No assertion was weakened. No sleep was added.
- No migration.

## Code review

Fixed point `origin/develop`. Reports of `50f242c`.

## Standards

No hard documented-standard breaches.

**Checked and clear.** `AGENTS.md`: the new spec is the required `e2e/` coverage for a UI change; comments and names use Ride and Transfer; `../shared/date` matches existing e2e imports, not a new deep module import. `GLOSSARY.md`: no avoid-words (trip, job, order, language, and the rest). `docs/agents/working-rules.md` (i18n and theme): no new copy, so both locales stay as they are; `z-[70]` is a Tailwind class on Nuxt UI theme slots, which that section and ADR-0016 allow (Nuxt UI + Tailwind, no second kit). The Nuxt UI design-system guideline merges global `slots` onto defaults via tailwind-merge, so `content: 'z-[70]'` does not replace the default menu classes. ADR-0016 records no z-index scale; `z-[70]` sits above the slideover `z-[60]` already used on the Ride and catalog panels.

**Judgement call — Duplicated Code** in `e2e/ride-panel-more.spec.ts`. The two tests are the same assertion with a different viewport:

```173:184:e2e/ride-panel-more.spec.ts
test('Više in the ride slideover shows a painted Ispravi transfer at laptop width', async ({ page }) => {
  await openRidePanel(page, 1280, 800)
  const item = page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true })
  await expect(item).toBeVisible()
  await expect.poll(() => menuFacts(item), { timeout: 5_000 }).toMatch(/^painted /)
})
test('Više in the ride panel shows a painted Ispravi transfer beside the table', async ({ page }) => {
  await openRidePanel(page, 1440, 900)
  // same item lookup and the same two expects
})
```

One helper that takes the width and the title would hold that shape. The PNG decoder stays local to this assertion, so it is not a second smell.

## Spec

### (a) Missing or partial

"Add or adjust an e2e test that opens Više in the Ride side panel on desktop and phone, in light and dark theme." Acceptance: "Više in the Ride side panel opens on desktop and phone, in light and dark theme." `e2e/ride-panel-more.spec.ts` only opens the panel at 1280 and 1440, and `openRidePanel` always calls `useTheme(page, 'light')`. There is no `@phone` tag, and the phone project runs only `@phone`. Dark is never opened, so "The dark variant of the same test passed in CI, which does not match the manual repro, so check it" is also unchecked. The CI failure named in the issue is the phone project, light theme.

"Remove the hydration mismatch warnings on the dashboard layout if they are the cause, or still if the fix is small. Otherwise list them in the PR." And: "There are no hydration mismatch warnings on /transfers load, or the remaining ones are listed with the reason." The diff does not touch the dashboard layout, the navbar title, or `ProfileMenu`, and it does not list any remaining warnings.

"Root cause stated in the PR, with evidence" and "Find the root cause with the browser (DOM + console) before changing code." The cause is a comment in `app/app.config.ts`. The branch has no DOM or console evidence.

### (b) Not asked for

"Fix it in product code" is the Više menu in the ride slideover. `e2e/fixtures/ui.ts` now waits until a previous listbox node is disconnected before `ArrowDown`. That changes `openListbox` for every caller. The issue only requires "stale-save and related specs are green. No assertion weakened." It does not ask for a new listbox-close wait. That wait is a separate load flake, not the z-index bug. `stale-save.spec.ts` assertions are unchanged.

### (c) Looks done, but wrong

"Open `/transfers?day=<day>&ride=<ride id>` so the Ride detail opens in the right side panel (slideover)." The 1440 test is the beside-table layout: `TransferDay` uses the slideover only below `min-width: 1440px`. That test never enters the z-60 panel. The file comment says the click proves the item can be used, but neither test clicks `Ispravi transfer`. They only require a painted screenshot. The CI failure was a timeout waiting for that menuitem.

Standards: 0 hard, 1 judgement call (duplicated viewport tests). Spec: phone, dark, and leftover hydration warnings are missing; the 1440 test is not the slideover.
