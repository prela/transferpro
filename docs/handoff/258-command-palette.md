# 258 Command palette and cross-day Transfer search

Out of scope: a new Transfer read (that is #250), theme commands in the palette, and the Driver shell.

## Decisions

- The office frame uses `UDashboardSearch`. Ctrl/Cmd+K opens it on the desktop. The phone top bar has a magnifier that opens the same palette. The built-in colour-mode group is off; theme stays in the profile menu.
- The screen list is `officeNav` for the signed-in office role. A Dispatcher does not see Revizija or Postavke tvrtke. "Novi transfer" uses the existing frame request.
- "Idi na dan…" opens a step whose placeholder asks for a date. A date typed at the root, without that step, also offers the jump. Dotted, slashed, and ISO forms become `?day=YYYY-MM-DD`.
- Transfer rows come from `GET /api/transfers/search`. The query is not logged. The palette's own cap is 12; the read returns 20, so the palette cap is 20.
- A calendar date is not an instant. `formatCalendarDate` lives next to `formatInstant` and uses the same day-month-year order. No migration.

e2e was not run in this slice.

Changed specs, rewritten rather than deleted:

- None. No earlier spec pinned this palette.
- `e2e/command-palette.spec.ts` — new, tagged `@phone`: Client reference, guest, and flight number each open that Ride on its day; the role's screens; Esc returns focus; "Idi na dan…" and a date typed at the root; light and dark axe, and English once.
