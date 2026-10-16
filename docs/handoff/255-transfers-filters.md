# 255 Transfers quick filters, search, and seven-day note

Out of scope: the occupation strip, the Ride detail panel, the command palette, print, a Tabla column, and Transfer search across days.

## Decisions

- The within-day search matches guest, flight, Client reference, and tabla. The day row has no Client reference column, and this ticket adds no migration, so the screen passes `clientReference: ''`. The predicate still matches a reference when the caller supplies one.
- The seven-day note is derived from `GET /api/office-home` unassigned pickups. That route already exists. Transfers calls it on the first full load only, not on later day refreshes, so an assignment does not wait on that read. The seven operational days start the day after the current operational day. The first of them is "sutra" / "tomorrow". Later days use the fixed short names (`sub`, `Mon`). No unassigned day in that window means no note. A click sets the day.
- Quick-filter counts are taken after the search and the Client and Driver filters, so the number on a chip is the number of rows that chip shows. Empty Client and Driver are `null` in the toolbar and `''` in `transferDayPartyMatches`.
- URL keys are `day`, `filter` (omitted when `all`), `search`, `client`, and `driver`. Changes use `router.push`, so Back restores them.
- Weekday names are calendar labels in `shared/transfer-day-query.ts`, not instants, so they do not go through `formatInstant`.
- No migration.

Changed specs, rewritten rather than deleted:

- `e2e/transfers-filters.spec.ts` — new: search, Client and Driver filters, URL and Back, the seven-day note, `@phone` light/dark axe and English once.
- `e2e/ride-assign.spec.ts`, `e2e/ride-occupation.spec.ts` — the assignment toast and the state cell are anchored with `/^Dodijeljeno/` and `/Dodijeljeno/`. A case-insensitive substring "Dodijeljeno" also matches the alarm chip "Nedodijeljeno < 4 h" when the pickup is inside four hours.

## Code review

Fixed point `origin/develop`. The reports below are the review of `df218e2`, before this handoff file existed.

## Standards

**Hard:** none.

Checked against `AGENTS.md` (imports stay on `shared`’s `index.ts`; the UI change adds `e2e/transfers-filters.spec.ts`; the `Dodijeljeno` assertions were anchored with `^`, not loosened), `docs/agents/working-rules.md` (both locale files, Nuxt UI and Lucide only, search input labeled and `text-base`, no new logs), ADR-0018 (catalogs stay behind existing `/api/*` reads), `GLOSSARY.md` (Client, Driver, Ride, and tabla stay the code terms), and ADR-0038’s label rule (the select label is Naručitelj / Client; the note uses the “sutra” / “sub” names). Those names are calendar labels, not instants, so they stay off `formatInstant`. `e2e/transfers-filters.spec.ts` imports `../shared/date` the same way the rest of `e2e/` already does.

**Judgement**

- **Duplicated Code** — `app/components/TransferDay.vue`. `buildQuery` and `routeQueryRecord` repeat the same `route.query` copy: `if (typeof value === 'string') { query[key] = value } else if (Array.isArray(value)) { const strings = value.filter(...) }`.
- **Speculative Generality** — `app/components/TransferDayToolbar.vue`. `partySearch` is a computed whose only result is `{ autofocus: false }`.
- **Primitive Obsession** — an empty Client or Driver filter is `null` on the models and `''` in `transferDayPartyMatches`, bridged with `clientId.value ?? ''`.

## Spec

**(a) Missing or partial**

- **"the handoff flags each changed spec and why."** `e2e/ride-assign.spec.ts` and `e2e/ride-occupation.spec.ts` were rewritten (`hasText: 'Dodijeljeno'` to `/^Dodijeljeno/`, because the new note’s "Nedodijeljeno" contains that substring). Nothing in the diff adds `docs/handoff/255-*.md` or any other note of those specs.
- **"A search within the shown day (guest, flight, Client reference, tabla) that filters what is loaded."** Guest, flight, and tabla narrow the loaded rows. Client reference does not: `TransferDay.vue` always passes `clientReference: ''`. The day payload (`transferSchema` / `transferDayRideSchema`) has no reference field, and the issue forbids a migration, so a reference query cannot match a loaded row. The unit test only covers the predicate with a made-up value.

**(b) Scope creep**

None. Quick filters, Client and Driver filters, URL query keys, the note, and the `@phone` light/dark axe pass (English once on light) are all in the issue. `pnpm` results are not in the diff; there is no migration.

**(c) Implemented, but wrong**

- **"Derived on the client from the office home read, which already returns every unfinished unassigned Ride of any day; no new read."** and **"No new server read is added."** The note is computed from `home.unassigned[].pickupAt`, and that list is every unfinished unassigned Ride. It is not taken from a read this screen already had. `useTransferDayLoad`’s first `loadAll` now `GET`s `/api/office-home`. The only other caller is `OfficeHome.vue`; the office shell does not load that payload on Transfers. ADR-0038 says that read "is loaded on every office screen for the count, so the note should need no new read."
