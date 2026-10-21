# 418 Client Ride history tab

Out of scope: the Partner Ride history, a migration, and a new command.

## Decisions

- Vožnje is the fourth tab on the opened Client, after Podaci, Kontakti, and Napomena. The screen calls `GET /api/clients/:id/ride-history`. `clients` does not import `transfers`.
- Each row shows the pickup via `formatInstant`, the guest, from and to, the state, the Driver or the Partner, and the price with the payment. Neither name is the unassigned label.
- Učitaj još follows `nextCursor`. The page stays 50. The counts line is the response `counts`, over the whole history.
- A row opens `/transfers?day={operationalDay}&ride={id}`.
- The cursor parser sits beside `encodeCursor` in the transfers loader, so `node:buffer` stays out of the screen bundle. The HTTP read is unchanged.
- After the review, the pickup formatter is named `clock`. The reports below are verbatim, before that rename.

## Code review

Reviewed `feature/418-client-ride-history-tab-8f44` against `origin/develop`.

## Standards

Documented standards hold.

The screen calls `GET /api/clients/:id/ride-history`. That read stays in `transfers` (`listClientRideHistory`, `officeOnly`), and `clients` does not import that module (`AGENTS.md`; ADR-0018; ADR-0036; ADR-0049). The cursor codec now sits beside `encodeCursor` in `server/modules/transfers/infrastructure/ride-history.ts`, so `node:buffer` stays off the screen bundle. Zod still rejects a bad cursor before a session opens. No new audit entry or log line. Both locales ship. Pickup time goes through `formatInstant`. The tab is Nuxt UI (`UAlert`, `UEmpty`, `UButton`) plus the same token-styled list the other card tabs use, Lucide `route`, and light/dark tokens (`docs/agents/working-rules.md`, i18n and theme; ADR-0016). Copy uses Client card and Ride history (`GLOSSARY.md`): Vožnje / Rides, and the counts line names total, done, No-show, and cancelled.

**Judgement — Duplicated Code.** `app/components/ClientRideHistory.vue` repeats helpers that already live on the other screens:

```107:110:app/components/ClientRideHistory.vue
function priceLabel(price: string): string {
  const shown = props.locale === 'hr' ? price.replace('.', ',') : price
  return `${shown} EUR`
}
```

The same function is in `TransferRideRow.vue`, `TransferRideDetail.vue`, and `DriverRideCard.vue`. `failureKey` is the same HTTP-status switch as `ClientContactPersons.vue` and `ClientNote.vue`. `loadFirst` and `loadMore` repeat the page read, the counts assignment, and the `failureKey` catch.

**Judgement — Mysterious Name.** `when` is the formatted pickup. Sibling rows call this `clock`:

```93:95:app/components/ClientRideHistory.vue
function when(ride: RideHistoryRow): string {
  return formatInstant(new Date(ride.pickupAt), props.timeZone, props.locale)
}
```

## Spec

**(a) Missing or partial**

None. The opened Client panel gains Vožnje after Podaci, Kontakti, and Napomena, on the phone dialog and the desktop panel. Rows show the pickup date and time in the Tenant zone, the guest, from and to, the state, the Driver or the Partner (unassigned when neither name is set), and the price with the payment. Order is the #417 read (newest pickup first, every state). "Učitaj još" follows `nextCursor` (50 per page). The counts line is the response `counts`, and the Croatian spec shows total 51 while only 50 rows are on screen. A row goes to `/transfers?day={operationalDay}&ride={id}`, which is the day board’s Ride detail. Croatian and English strings are both present. Light and dark use the existing theme tokens. The new spec opens the tab, loads more, and opens a Ride in Croatian and light, with an English dark smoke, and runs axe on both. No test is removed or weakened. The clients page stays office-only. There is no migration and no new command, and the screen calls `GET /api/clients/:id/ride-history` without importing transfers.

**(b) Scope creep**

The cursor parser moves from `shared` into the transfers loader, with the same rules, so the screen can import the response schema without `node:buffer`. The HTTP read is unchanged. "The screen uses the read from #417. No migration and no new command."

The tab also has a loading line, an empty state, and alerts for 400, 401, 403, 404, and other failures. Stories 22–28 and the #418 acceptance criteria do not ask for those. They match the other card tabs.

**(c) Implemented but wrong**

None.
