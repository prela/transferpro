# 146 Attention lists on Home

Out of scope: a decline command, a stored alarm, mail for the alarm, a live flight link, and week, month, or euro totals.

## Decisions

- Office Home is one `GET /api/office-home`. `buildOfficeHome` classifies the three lists and the seven counts from one Ride query at one `now`. Do not split them into two reads.
- Expiring documents stay `GET /api/expiring-documents`. The office refresh reloads both. Driver Home keeps its own document button. Home does not poll.
- The unassigned alarm is computed at read time: on when `pickup > now` and `pickup - now <= 4h`, including exactly four hours before, off at the pickup instant and after. It is not a column and it sends no mail.
- In progress is derived. Do not add a Ride state for it. A declined Ride is unassigned. There is no declined state.
- Counts use `localDayBounds` and `operationalDateInTimeZone`. Do not use `calendarDateInTimeZone` for a Ride day. The roster and expiring documents stay on the calendar date.
- The office allow-list is admin or dispatcher, checked before a Ride is read. A missing name for a set Driver, Vehicle, or Location fails the whole read with `Office home read failed`. Do not log a guest, a flight, an address, a phone, or a price.
- No migration.
- The board day assertion is the textbox named exactly `Dan`. `getByLabel('Dan')` also matches the Home counts heading, “Brojevi za operativni dan”, and `toHaveValue` then throws before the board route paints.

## Code review

Fixed point `origin/feature/115-office-home-bf0e` (`0cb12c9`). Commits `9d52051` (already on develop, #149), `796dfd6` (merge), `8f7ad5b`.

## Standards

No hard breach of `AGENTS.md`, `docs/agents/working-rules.md`, ADR-0018, or ADR-0021–0024. One transfers query; `readOfficeHome` allow-lists admin and dispatcher before any Ride load; Zod on the SQL rows and the response; both locales; `formatInstant`; no poll, audit write, or mail. Catalog names come through each module index.

**Documented, minor.** `GLOSSARY.md` (Location, avoid “place”) and `AGENTS.md` (“use those terms”). `office-home.ts` maps Locations with `place`. `e2e/office-home.spec.ts` names `{ clientId, startLocationId, endLocationId }` `places`.

**Judgement — Duplicated Code.** `loadOfficeHome` repeats the list rules in SQL:

```sql
or r.state = 'unassigned'
or (r.state = 'assigned' and r.must_accept is true)
or (
  t.pickup_at < ${nowIso}
  and r.driver_id is not null
  and r.state not in ('done', 'no-show', 'cancelled', 'unassigned')
  and not (r.state = 'assigned' and r.must_accept is true)
)
```

`attentionList` in `shared/office-home.ts` decides the same three lists, and `buildOfficeHome` applies the operational day again. The comment says a row outside the filter cannot change the result, so the copies must stay identical or a Ride disappears. ADR-0022, ADR-0023, and ADR-0021 do not ask for a second definition.

**Judgement — Duplicated Code.** `OfficeHome.vue` repeats the same article for all three lists (unassigned adds only the alarm). Waiting and in progress are this block:

```html
<article class="rounded-lg border border-default bg-default p-4 text-base">
  <h3 class="text-lg font-semibold">{{ ride.guestName }}</h3>
  <OfficeHomeRideFacts :ride="ride" :time-zone="timeZone" :locale="locale" />
</article>
```

**Judgement — Duplicated Code.** `OfficeHomeRideFacts.vue` copies `priceLabel` from `DriverRides.vue` (same `pickupLabel` wrapper). Working rules require `formatInstant` for instants; they do not require one price helper, so this stays a smell:

```ts
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}
```

**Judgement — Repeated Switches.** `buildOfficeHome` cascades on `list` once to increment counts and again to push the row.

**Judgement — Mysterious Name.** `loadLocations(transaction, true)` and `loadVehicles(transaction, true)` do not say “include archived”. `type Row = OfficeHome['waitingOnAcceptance'][number]` names the shared row after one list.

## Spec

The product diff matches issue #146. The two files from #149 are excluded.

**(a) Missing or partial:** none.

**(b) Scope creep:** none. Removing the example clock is the Home the spec describes.

**(c) Implemented but wrong:** none.

Checked against the spec: one `GET /api/office-home` builds all three lists and the seven counts from one ride query and one `now`; open and keyboard refresh each load that read and `/api/expiring-documents`; there is no timer. Unassigned is every `unassigned` Ride, soonest pickup first, including other days and past pickups. The alarm is the text “Unassigned alarm” / “Alarm za nedodijeljenu vožnju”, on for `pickup - now <= 4h` and `pickup > now`, off at pickup and after, with no mail. Waiting is `assigned` with the Ride’s `mustAccept` copy on, any pickup, no alarm; `accepted`, `cancelled`, and must-accept-off are excluded, and a decline back to `unassigned` is not waiting. In progress is derived (`driver`, not done/no-show/cancelled, not waiting, `pickup < now`), includes earlier days, and the three lists are exclusive. Counts use the 05:00 operational day only, so a list can be longer than its count; there is no week, month, or euro total. Rows show price and payment for cash, card, and invoice to agency, and the flight number as text. Each read can fail while the other still shows; an empty list says it is empty. A Driver still gets upcoming Rides (cash-only price) and own documents; the office read returns 403. A signed-out visitor gets the sign-in form; another Tenant’s snapshot is empty. Copy is in Croatian and English, the new UI uses theme tokens, there is one `h1`, and locale and theme stay off office Home. No migration and no new Ride state.
