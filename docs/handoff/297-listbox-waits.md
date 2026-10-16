# 297 Flaky listbox waits

Out of scope: no application change, no timeout increase, no retry, and no migration.

## Decisions

- One helper in `e2e/fixtures/ui.ts`. `openListbox` opens a combobox with ArrowDown and a select-menu button with a click, then waits until that trigger's `aria-expanded` is true and its `aria-controls` listbox is visible. `selectOption` waits for the named option to be visible, confirms a combobox with Enter and a menu with a click, and waits until that list is hidden. `chooseOption` then checks the trigger text.
- A pointer click is not the open. USelect opens on pointerdown, and the click that follows can close the list before the option is visible. The open list also hides the trigger from the accessibility tree, so the expanded check reads the same DOM node.
- A suggestion list left open by the address field stays open when the next control is opened from the keyboard. Escape is sent only while some listbox is already open, then the helper uses the trigger's `aria-controls` so a second open list is not the one under test.
- Roster passes `exact: false` because a plate already given that day is labelled with a suffix. The old roster locator was not exact.
- No assertion was removed. Option checks that used `toBeAttached` now require the option to be visible.

## Code review

Fixed point `origin/develop`. The reports below are the review of `3bd1d97`, before the time-zone field used the helper and before the listbox was scoped to `aria-controls`.

## Standards

No hard violations. The diff stays inside e2e helpers and call sites. It does not weaken or drop an assertion (`AGENTS.md` tests), touch tenant data or secrets (`AGENTS.md` security), or use a `GLOSSARY.md` avoid-word. `docs/agents/working-rules.md` only describes how `pnpm test:e2e` runs; nothing in the diff contradicts that.

Judgement calls:

**Mysterious Name** — `e2e/fixtures/ui.ts`. `chooseOption` still names its locator `combobox` after callers pass select-menu buttons (`chooseMenu`, the Client filter, the operational-day hour). Inside `selectOption`, `combobox` is a boolean and `opened` is an element handle:

```164:168:e2e/fixtures/ui.ts
export async function selectOption(page: Page, trigger: Locator, name: string, exact = true) {
  const combobox = await trigger.getAttribute('role') === 'combobox'
  const listbox = await openListbox(page, trigger)
```

```141:142:e2e/fixtures/ui.ts
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    const opened = await trigger.elementHandle()
```

**Middle Man** and **Duplicated Code** — the same one-line delegate is left in both files:

```19:21:e2e/transfer-form.spec.ts
async function chooseMenu(page: Page, dialog: Locator, field: string, option: string) {
  await chooseOption(page, dialog.getByRole('button', { name: field, exact: true }), option)
}
```

`e2e/transfers.spec.ts` has the identical function.

**Duplicated Code** — `createFromSelect` (`e2e/transfer-form.spec.ts`) and `addPlace` (`e2e/transfers.spec.ts`) both open the list, fill `listbox.locator('input')`, and click `` `+ Dodaj ‘${name}’` ``. `e2e/settings.spec.ts` still builds the open list itself: `page.locator('[role="listbox"][data-state="open"]')`, the same selector `openListbox` just centralized.

**Repeated Switches** — `openListbox` and `selectOption` each branch on `role === 'combobox'` (ArrowDown versus click, Enter versus click).

## Spec

### (a) Missing or partial

**Partial.** "One shared way to open a listbox and pick an option" and "so every spec opens and picks from a listbox the same way." `openListbox` / `selectOption` / `chooseOption` cover the ride specs (`chooseOption` already in `ride-change.spec.ts` and `ride-occupation.spec.ts`; `ride-assign.spec.ts` now uses both). `e2e/settings.spec.ts` still opens the time zone with `zone.click()`, then hand-rolls the expanded and option waits and clicks the option. That combobox is the case `openListbox` refuses to click.

**Partial (verification, waived).** "Full e2e, pnpm lint, pnpm typecheck, pnpm test pass." Lint, typecheck, and unit tests are reported green. Full e2e was not run; the review instruction forbade it. "The affected specs pass 5 times in a row locally" is met by the reported 110 passes.

### (b) Scope creep

None. Call sites outside the three failures (audit, members, roster, transfers, invite role, catalog) are the "every spec … the same way" line. No timeout, retry, `test.slow`, or `waitForTimeout` was added. No app code changed.

### (c) Implemented but wrong

The time-zone path waits on `aria-expanded` and a visible option ("Wait on observable state … rather than time"), but it still opens with the pointer click `openListbox` documents as the close race. The shared helper does not replace that open.

## After that review

The time zone opens through `openListbox`. The first full e2e then failed in `e2e/locations.spec.ts`: the address suggestion list and the kind select were both open, and the page-wide listbox locator matched both. Escape closes a list that is already open, and the helper waits on the trigger's `aria-controls`. Conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (559) passed, then `pnpm test:e2e` — 219 passed. No migration.
