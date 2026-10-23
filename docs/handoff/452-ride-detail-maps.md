# 452 Maps on the Ride detail

Out of scope: the place-reference refresh and `place_ref_checked_at` stay #453, and the Location panel map is #451.

## Decisions

- `LocationMapToggle` is the shared frame. The Location panel and the Ride detail both use it. The iframe is mounted only while the map is open.
- `rideDetailEmbedUrls` keeps the start URL and omits the end when the two Location ids match.
- `pinActions` is the phone layout. Opening one map closes the other. A desktop leaves the other as it was.
- The open flags stay while the Ride and both URLs stay the same, so a live refresh does not remount the frame. A new URL updates `src` on that same frame. A null URL, or another Ride, closes that map.
- `loadDay` reads Locations with `cache: 'no-store'` beside the day. A failed location read keeps the list already on screen, the day still updates, and the other catalogs wait for the next full load.
- A Location created from the Transfer form is parsed with `officeLocationSchema`, so the new row keeps `embedUrl`.
- The board row, the day print, the occupation strip, and the table take `readonly Location[]`. They stay text.
- The same-place end-to-end writes `end_location_id` after record, because the record route refuses the same Location.
- No migration. `embedUrl` is still built on the office read.
- Desktop covers both locales, both themes, and axe with the maps closed and open. Phone covers light with Croatian and dark with English, one map at a time, and axe.
- The reports below are verbatim from the review of `4751099...c6184c2`.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (947) passed. `pnpm test:e2e` passed (345, 5.4m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

## Standards

**Documented.** No hard breach of `AGENTS.md`, ADR-0018, ADR-0038, ADR-0039, ADR-0052, or the i18n, theme, logging, and tenant-session rules. The iframe stays out of the document until the press, uses `referrerpolicy="strict-origin-when-cross-origin"`, an empty `allow`, no `sandbox`, a 240px theme-token border, and existing `hr`/`en` strings (`Prikaži na karti` / `Show on map`, `Karta:` / `Map:`). Office reads go through `officeLocationSchema`. Phone uses `pinActions` (set only when `layout === 'phone'`). An unchanged Embed URL leaves the frame mounted.

**Glossary naming (documented, mild).** `GLOSSARY.md` **Location** — _Avoid_: place, stop. `TransferRideDetail.vue` renames `place` to `placeLabel` and still calls a Location label a place:

```186:188:app/components/TransferRideDetail.vue
function placeLabel(location: OfficeLocation | null): string {
  return location ? locationLabel(location) : t('transfers.unknownPlace')
}
```

The e2e error `'The ride was not made a same-place ride.'` does the same.

**Baseline smells (judgement only).**

- **Duplicated Code** — the same toggle is written twice in `TransferRideDetail.vue`:

```511:517:app/components/TransferRideDetail.vue
        <LocationMapToggle
          :open="startMapOpen"
          :embed-url="mapUrls.start"
          :name="startLocation?.name ?? ''"
          :phone="pinActions"
          @update:open="pressMap('start', $event)"
        />
```

The end block is the same with `endMapOpen`, `mapUrls.end`, and `endLocation`. `rideDetailMapOpen` repeats the same `if` for each slot (`press?.slot === 'start'` then `'end'`).

- **Speculative Generality** — `rideDetailMapOpen` drops a press when `rideChanged` is true, but the component never sends both: `pressMap` always passes `false`, and the watch always passes `null`. Only the unit test builds that pair.

## Spec

## (a)

None. The success path covers both buttons, one button when the start and the end are the same Location, independent desktop toggles, one map at a time on a phone, frame and button rules shared with the Location panel, and the live-refresh cases (unchanged frame, one reload, close when the URL is null, close when another Ride opens). Board rows, the day print, the CSV export, and the Driver's card are untouched. The fake-adapter e2e covers both locales, both themes, and axe with the maps closed and open.

## (b)

None.

## (c)

A live refresh that fails the location read still counts as a success. `loadDay` updates the day, returns `ok`, and keeps the previous catalog when `GET /api/locations` fails, so an open map stays up and its button stays after that reference was cleared or replaced.

Spec: "It reloads once when the URL changes. It closes, and the button goes, when the URL becomes null."
