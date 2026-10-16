# 254 Transfers day table

Out of scope: within-day search, Client and Driver filters, the seven-day unassigned note, the occupation strip, the Ride detail panel, the command palette, print, and a Tabla column.

## Decisions

- The day control id is the literal `transfer-day` on the label `for` and the input `id`. Do not switch it to Vue `useId()`. That generator was the server/client mismatch (`v-0-0-11-0` vs `v-0-0-0-0`).
- `claimDayLoad` returns without incrementing when the date is not a calendar date, so an early `loadDay` does not retire an in-flight `loadAll`. `claimFullLoad` always increments.
- Transfers uses `useLiveRefresh` / `createLiveRefresh`. Do not add a second timer. A later failure does not set `loadError` once a read has succeeded, and it does not empty the list.
- The day and the filter live in the URL (`day`, `filter` omitted when `all`). A locale switch keeps `?day=`.
- One Ride row is in the DOM. `phoneLayout` stays false until after mount, then follows `(max-width: 1023px)`, so phone and desktop button ids are not both present.
- The phone card is two lines: time, guest, and the state badge; then route, crew, and marks beside the action. Desktop rows are `h-9` (36 px), 14 px text, 28 px controls. Phone controls in the row are 44–48 px. There is no density toggle.
- An in-progress Ride uses the info colour and the car icon, and the text stays the stored state (`Dodijeljeno` / `Prihvaćeno`). Only waiting (`assigned` and `mustAccept`) says "Čeka prihvat". The filter is still "U tijeku".
- Unassigned is `warning` + `outline`, badge size `md` with `!text-sm`, and `color: var(--ui-text)`. A warning fill and `size="sm"` (`text-[10px]/3`) fail light-mode axe.
- Finished rows mute the badge (`opacity-70`) and the crew cell. Do not mute the whole row; body-muted text fails the contrast floor.
- Marks sit in the state cell and can grow a marked desktop row past 36 px. The density check uses a row with no marks.
- Home mounts `TransferRideRow` with `cell="home"` and keeps the old office-home sentences. The eight-column row is Transfers only. The office-home read has no passenger count and no Client.
- Naručitelj is the Client name. The day read has no Client reference field.
- The failed-refresh e2e stubs `window.fetch` for `/api/transfers`. `page.route` does not see that `$fetch`.
- No migration.
- e2e, after `pnpm exec nuxi build`: `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" E2E_PORT=3076 pnpm test:e2e` — 175 passed. Port 3000 was already in use, so the suite did not use the default port and did not attach to that process. The same command and count passed once before the phone two-line fold and once after it.

Changed specs, rewritten rather than deleted:

- `e2e/transfers-table.spec.ts` — new: stable day id, URL day and filter, eight columns and 36 px row, failed refresh keeps the row, `@phone` light/dark axe and English once.
- `e2e/transfers.spec.ts` — no Tabla column; guest cell is a prefix; state cell is a prefix because marks append text.
- `e2e/landing-time.spec.ts`, `e2e/expected-arrival.spec.ts` — the column is Let / Flight.
- `e2e/record-landing-time.spec.ts`, `e2e/work-order-cancel.spec.ts`, `e2e/work-order-change.spec.ts`, `e2e/ride-change.spec.ts`, `e2e/landing-alarm.spec.ts` — cancel, change vehicle, and record landing open from `⋮` (`openRideMenu`).
- `e2e/board-warnings.spec.ts`, `e2e/ride-occupation.spec.ts`, `e2e/driver-rides.spec.ts` — short mark text (Preklapanje, Istekao dokument, Odbio). Locale switch no longer resets the day field. Phone 390 uses `listitem`.
- `e2e/ride-assign.spec.ts`, `e2e/day-list-accept-by-phone.spec.ts`, `e2e/correct-transfer.spec.ts` — state and guest cells are prefixes; accept is "Potvrdi telefonom".
- `e2e/theme-pages.spec.ts` — the day field is `getByRole('textbox', { name: 'Dan', exact: true })`.
- `e2e/fixtures/ui.ts` — `openRideMenu`.

## Code review

Fixed point `origin/develop`. The reports below are the review of `7f5e594`. The following commit folds the phone action into the second line, which Spec (c) called three blocks.

## Standards

No hard violations of `AGENTS.md`, `docs/agents/working-rules.md` (UI, i18n, logging), `docs/adr/0018-module-boundaries.md`, or `GLOSSARY.md`. Both locales ship. Instants go through `formatInstant` / existing `clockLabel`. Imports stay on `shared`. Nuxt UI and Lucide only. No new logs.

### Judgement calls

**Duplicated Code** — alarm windows copied from `shared/office-home.ts` into `shared/ride-attention.ts`:

```9:16:shared/ride-attention.ts
const UNASSIGNED_ALARM_MS = 4 * 60 * 60 * 1000
// ...
const UNCLOSED_MARK_MS = 60 * 60 * 1000
```

The past-pickup, four-hour, and unclosed predicates are copied with them.

**Duplicated Code** — `TRANSFER_DAY_FILTERS` is declared again in `TransferDayToolbar.vue` and as the counts object in `transferDayFilterCounts`:

```26:26:app/components/TransferDayToolbar.vue
const filters: TransferDayFilter[] = ['all', 'urgent', 'warnings', 'unassigned', 'waiting', 'inProgress', 'closed']
```

**Duplicated Code** — `TransferRideTable.vue` repeats the same `TransferRideRow` binding for `#time-cell` through `#actions-cell` (nine slots).

**Repeated Switches** — `ride.state` is cascaded in `classifyRideAttention`, `transferDayFilterMatches`, and `rideStateMark` in `shared/ride-attention.ts`.

**Mysterious Name** — `crew`, `crewText`, and `unassignedCrew` mean Driver and Vehicle (`GLOSSARY.md` has no Crew). The visible copy is “Driver · vehicle”.

## Spec

**(a)** The Naručitelj cell is only the Client name. ADR-0038: "Naručitelj (with the Client reference in small text)". The day row has no reference field, so that part of the column is absent. Search, Client and Driver filters, and the seven-day note are the same paragraph, but they are issue #255 (blocked by #254), so they are not missing from this slice.

**(b)** None against #254. The quick-filter bar is #255's first bullet, and #254 also asks for "Day and filters in the URL", so it is early overlap, not an unasked behaviour.

**(c)**
- Phone rows are three blocks (time and guest, route and crew, then actions). #254: "Phone: two-line rows, no horizontal scrolling."
- An in-progress Ride is coloured and iconed as in progress, but the text stays the stored state ("Dodijeljeno" or "Prihvaćeno"). ADR-0040: "A Ride state is icon, text, and colour: … in progress in info". Unassigned uses `warning` + `outline`, the same treatment ADR-0040 reserves for "waiting on acceptance in warning, outlined".
- Finished rows mute the badge (`opacity-70`) and the crew cell. Time, guest, and route stay full strength. ADR-0038: "Finished Rides stay under Sve, muted".
- Attention text is stacked under the badge, so a marked row grows past the band. #254: "Row 36–40 px". The e2e allows 48 px and only measures a row with no marks.
- Home mounts `TransferRideRow` with `cell="home"`, which is still the old stacked card (no Client, no single action, old alarm sentences). #254: "A shared Ride row that Home reuses."

The #252 items match the comment: `claimDayLoad` does not bump the counter on a non-date, and the day control id is the fixed `transfer-day`.
