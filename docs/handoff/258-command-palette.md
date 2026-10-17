# 258 Command palette and cross-day Transfer search

Out of scope: a new Transfer read (that is #250), theme commands in the palette, and the Driver shell.

## Decisions

- The office frame uses `UDashboardSearch`. Ctrl/Cmd+K opens it on the desktop. The phone top bar has a magnifier that opens the same palette. The built-in colour-mode group is off; theme stays in the profile menu.
- The screen list is `officeNav` for the signed-in office role. A Dispatcher does not see Revizija or Postavke tvrtke. "Novi transfer" uses the existing frame request.
- "Idi na dan…" opens a step whose placeholder asks for a date. A date typed at the root, without that step, also offers the jump. Dotted, slashed, and ISO forms become `?day=YYYY-MM-DD`.
- Transfer rows come from `GET /api/transfers/search`. The query is not logged. The palette's own cap is 12; the read returns 20, so the palette cap is 20.
- A calendar date is not an instant. `formatCalendarDate` lives next to `formatInstant` and uses the same day-month-year order. No migration.
- The listbox has no name from `UDashboardSearch`. After the dialog renders, the palette sets that name to the search placeholder. The default modal is a fixed 28rem, so the result list scrolls; the dialog grows with the list instead.
- On the phone, the Ride detail covers the top bar. The search spec goes Back before it opens the palette again.

`pnpm exec nuxi build`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` (565 passed), then `E2E_PORT=30258 pnpm test:e2e` — 229 passed. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; the high and critical findings are ignored).

Changed specs, rewritten rather than deleted:

- None. No earlier spec pinned this palette.
- `e2e/command-palette.spec.ts` — new, tagged `@phone`: Client reference, guest, and flight number each open that Ride on its day; the role's screens; Esc returns focus; "Idi na dan…" and a date typed at the root; light and dark axe, and English once.

## Code review

Fixed point `origin/develop`. The reports below are the review of `3427bd7` before the follow-up on this branch. `formatCalendarDate`, the `@phone` tag, `PaletteRow`, the nested day step, the 20-row cap, the listbox name, and this handoff landed after that review.

## Standards

### Hard

**Second date formatter.** The palette printed a calendar day with its own order, beside `formatInstant`. `docs/agents/working-rules.md` (i18n): render instants with `formatInstant`; do not add another date formatter.

**`e2e/command-palette.spec.ts` — phone project.** The search, the role list, Esc, and "Idi na dan…" were not inside `test.describe('@phone')`, so the phone project never ran them. English ran only in the light theme.

### Judgement

**Primitive Obsession.** Palette groups were `Record<string, unknown>[]`. A row type belongs on the palette. (`CommandPaletteItem` is too deep for vue-tsc, so the follow-up uses `PaletteRow`.)

## Spec

### (a) Missing or partial

- The handoff was missing, and the slice note still said e2e was not run. The acceptance asks the handoff to flag changed specs and to carry this review.
- The phone magnifier did not run the cross-day search. The `@phone` project only reached the axe case.

### (b) Scope creep

None. Theme commands stay off. The Driver shell and the platform shell do not mount the palette. The search route is the #250 read.

### (c) Implemented but wrong

- "Idi na dan…" had no destination, so choosing it did nothing.
- The palette cap of 12 hid hits the read is allowed to return (20).
