# 265 Raspored week grid

Out of scope: a batch roster write, occupation strip, and any server or migration change.

## Decisions

- Copy is planned in `planRosterCopy` (empty cells only; skip archived Vehicle and Vehicle already given). Server refusal is appended after each PUT. The copy is not atomic.
- Desktop is a Monday–Sunday grid with save-on-select. Phone is one day, `Danas`, pickers `xl` / 44 px. Both use the existing per-day GET and per-Driver PUT.
- A Vehicle already given that day is labelled in the picker and stays selectable; a refused save reverts the picker so the same Vehicle can be chosen again.
- Weekday headings use `Intl` on a calendar date, not `formatInstant` (no instant).
- After review, `roster.missingVehicle` was restored to `odaberite`.
- No migration.

Changed specs, rewritten rather than deleted:

- `e2e/roster.spec.ts` — save-on-select instead of Spremi; week/day chrome instead of the date field; copy summary and refused-cell skip; `@phone` light/dark axe and English once.
- `e2e/theme-pages.spec.ts` — Datum/Date replaced with Ovaj tjedan / Danas (and English This week / Today) by viewport.

## Code review

Fixed point `origin/develop` (`234b499`). Uncommitted working tree at review. The reports below are the review as it ran.

## Standards

**Hard documented violations:** none. i18n keys land in both locales; desktop controls are `sm`, phone `xl` + `min-h-11` (ADR-0016 / ADR-0038); `$fetch` bodies go through Zod; imports go through `shared/index.ts`.

**Judgement — documented**

- **`RosterDay.vue` `dayHeading`.** `docs/agents/working-rules.md` (i18n): “Render instants with `formatInstant`; do not add another date formatter.” New `Intl.DateTimeFormat` in the Vue file. These are calendar headings, not pickup instants (`formatInstant` would add a time), so this is not a hard breach; a shared calendar-heading helper would still match the “one formatter” intent.

**Judgement — smells**

- **Duplicated Code — `RosterDay.vue` template.** Desktop cell vs phone list repeat archived / missing / saving / saved / error / clear. Extract one cell renderer.
- **Duplicated Code — `e2e/roster.spec.ts`.** `addDays` / `mondayOf` copy `addCalendarDays` / `mondayOfWeek` from `shared/date.ts`. Other e2e already imports `shared`.
- **Duplicated Code / Primitive Obsession — composite keys.** Same `` `${driverId}:${date}` `` in `cellKey`, `planRosterCopy` (`filled` / `lastByCell`), and skip-list keys. A small cell-id type would replace the string.
- **Duplicated Code — “given that day”.** `givenVehicleIds` and `planRosterCopy`’s `givenByDay` both collect vehicle ids per date excluding/skipping occupied cells.
- **Mysterious Name.** `pick` / `write` / `iso` (in `dayHeading`) do not say vehicle-save / calendar heading.

No Feature Envy, Shotgun Surgery (i18n + shared + e2e is the expected scatter), Speculative Generality, or Middle Man worth calling. Native week `<table>` is allowed by ADR-0038 (build the roster grid; keep `UTable` for other lists).

## Spec

### (a) Missing or partial

- **Handoff not written.** #265: “Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; **the handoff flags each changed spec and why**.” `e2e/roster.spec.ts` and `e2e/theme-pages.spec.ts` are rewritten (date picker / Save → week/day chrome and save-on-select). There is no `docs/handoff/265-*.md`.

- **Copy skip-why on the plan vs the screen.** #265: summary of skipped “**(archived Vehicle, Vehicle already given, refused by the server)**.” `planRosterCopy` only returns `archivedVehicle` | `vehicleGiven`; “refused” is applied after each PUT. That matches “not atomic,” and e2e covers refusal. Unit tests never exercise the refused reason (they only cover the pure plan).

### (b) Scope creep

- **Unrelated Croatian edit** of `roster.missingVehicle` (`odaberite` → `odaberete`). Not in #265, #242, or ADR-0038.

- **Phone first load still does seven day reads** (`loadAll` → `loadDates(week)`). ADR-0038: “**On the phone, Raspored is one day**”; seven reads are specified for the desktop week. UI is one day; the extra GETs were not asked for.

- **Desktop week and phone day are separate cursors** (`weekStart` vs `phoneDate`). Crossing the `lg` breakpoint does not keep the same dates. Not in the spec.

### (c) Looks implemented, looks wrong

- **That Croatian string is now ungrammatical.** #265: “**Croatian and English labels follow ADR-0038**.” `Uklonite ga ili odaberete drugo` is not valid HR (was `odaberite`).

No other acceptance hole vs the roster paragraph: week grid + save-on-select + cell status + `◀ Ovaj tjedan ▶` + seven GETs / existing PUT; given Vehicles marked and still choosable; copy empty-only, cell-by-cell, summary; phone `◀ Danas ▶` + large pickers; no server/migration files; `@phone` axe light/dark and EN once.
