# 261 Occupation strip

Out of scope: drag and drop, a lock, a Partner row, and any server or migration change.

## Decisions

- A block is the ADR-0029 window: it opens at the pickup and ends at the stored landing plus the transfer duration, or at the pickup plus that duration. A landing shifts the end. The start stays the pickup. An empty window (the duration finishes before the pickup) is omitted.
- The relocation gap is not drawn. A true overlap and a short gap both use the short row word (Preklapanje / Overlap) plus a warning outline. A gap equal to the relocation gap is quiet. The button is the occupation window; the caption sits under it and does not widen the click target.
- Rows are roster Vehicles for that day, plus any Vehicle that has an assigned or accepted Ride. The label is the roster Driver. Unassigned, done, no-show, and cancelled Rides are absent.
- Placement uses the Tenant's transfer duration and relocation gap from the existing settings read, and the day's roster from the existing roster read. The filtered table does not hide blocks.
- Collapsed state is `localStorage` per Tenant and user (`transferpro-occupation-strip:<tenant>:<user>`). Absent means open.
- The strip is `hidden` below the `lg` breakpoint (the phone layout). That is the ADR-0038 exception.

Changed specs:

- `e2e/occupation-strip.spec.ts` — new. No earlier spec asserted that the strip was absent, so none was rewritten. This spec is the accessible name, the Ride detail, the warning word, collapse across reload, English in the dark theme, and absence at 390 px. The overlapping block is opened from the keyboard because the later window covers the centre of the earlier one.

## Code review

## Standards

**Hard:** none. Both locales ship, instants go through `formatInstant` / the existing `clockLabel`, fetches are Zod-parsed, the strip uses `UButton`, `UAlert`, and theme tokens, desktop controls are 28px (`h-7`), and `hidden lg:block` is the ADR-0038 phone exception. Glossary nouns are unchanged. `e2e/` deep-imports of `shared/date` match the rest of that folder.

**Judgement**

- **Mysterious Name** (`OccupationStrip.vue`): `ticket` is a load generation counter.
  ```
  let ticket = 0
  const current = ++ticket
  ```
- **Duplicated Code** (`OccupationStrip.vue`): the same “if ready, load” body is two watches.
  ```
  watch(() => props.day, () => { if (ready.value) void load() })
  watch(() => props.rides, () => { if (ready.value) void load() })
  ```
- **Data Clump** (`occupation-strip.ts`, the Vue ref, the test `place` helper): `{ driverId, vehicleId }` is redeclared three times. `RosterAssignment` already exists in `shared/roster.ts`.
- **Speculative Generality** (`occupation-strip.ts`): `startMs` and `endMs` are returned and neither the component nor the tests read them.
  ```
  return { startMs: axisStart, endMs: axisEnd, now: ..., ticks: ..., rows }
  ```
- **Primitive Obsession** (`hourTicks`): the hour is a slice of the wall-clock string (`YYYY-MM-DDTHH:mm`) instead of a parsed field.
  ```
  hour: Number(wall.slice(11, 13)),
  ```

## Spec

**(a) Missing or partial**

None. Placement tests cover a normal block, a landing-shifted end, and an overlap. Blocks are buttons whose accessible name is time, passenger count, and route, and they call the existing Ride detail opener. Collapse is stored as `transferpro-occupation-strip:<tenant>:<user>` and restored on mount. The strip is `hidden` below `lg` (the office phone break, 1024). The diff adds no server or migration files. Croatian and English use the ADR-0038 short word "Preklapanje" / "Overlap". No glossary term in code is renamed. No existing e2e spec was deleted. The handoff says none had pinned the strip's absence, and the new spec replaces that silence.

**(b) Scope creep**

"The strip needs no server change" does not ask for a failure state. If the existing settings or roster read fails, the strip is replaced by "Occupation could not be loaded." / "Zauzetost se nije mogla učitati."

**(c) Implemented, but wrong**

"A block is the Ride's ADR-0029 occupation … without the relocation gap." Warning blocks set `min-w-28` (7rem) and every block sets `min-w-7`, on top of the occupation fraction. On a 24-hour axis a one-hour block is only a few dozen pixels, so the painted button is wider than the window. A short gap ("A short gap or an overlap shows as a warning outline with text") is then covered by the neighbouring warning button, and the click target is no longer the occupation.

e2e was written, not run. The acceptance requires `pnpm lint`, `pnpm typecheck`, and `pnpm test`, not an e2e run.

After that review, the load counter was renamed, the two watches were joined, rows use `RosterAssignment`, `startMs` and `endMs` were dropped, and the button was narrowed to the occupation window. The hour tick is still read from the wall-clock string. Conclude then ran the whole e2e suite: 205 passed.
