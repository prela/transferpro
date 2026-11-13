# Transfer list: remembered filters and what the counts follow

Status: accepted

The owner accepted this on 13 November 2026, in the grill of #584. It partially supersedes ADR-0038; the sentence is named below. ADR-0039 and ADR-0057 stand. ADR-0060, which #564 implements, stands: its layout, its "Očisti filtre" buttons, its line for hidden urgent Rides, and its result count. The filter logic of #546 is unchanged.

## Context

A walk of the preview found that a reload keeps the view and the filters on Transfers, because they live in the address, but going to Home and back drops them. The sidebar and the phone bottom bar link to a bare `/transfers`. ADR-0038 chose that: "There are no saved views; a link with its filters serves that purpose."

The same walk read the counts as following some filters and not others. The code has one rule. The search and the six filter fields (Client, Driver, Vehicle, Partner, Ride state, and "Treba pažnju") narrow the loaded day in the browser. Every view count is taken over that narrowed set and never over the chosen view. Choosing "Nedodijeljeno" therefore changes no count, while a Driver filter changes Sve and Upozorenja. "Hitno (n)" is the exception: it counts every Ride of the shown day, and the filter spec pins that for the Ride-state, search, and Vehicle filters. The Početna badge counts the Rides in Pozornost from the Home read, of any day, so it can differ from "Hitno (n)".

For how long a filter lasts, the alternatives were the address only, as today; this tab's working session; this device across sessions; and every device through the server. For the counts they were no count following the filters, and every count following them, Hitno included. For the badge they were the current operational day only, and a hint on Transfers for urgent Rides on other days.

## Decision

### How long the view and the filters last

The view and the filters last for the working session in one browser tab. The Transferi item in the sidebar and in the phone bottom bar, and `+ Novi transfer` opened from another screen, return to the last view and filters of Transfers in that tab. Closing the tab, signing out, the idle sign-out of ADR-0057, the end of a session, and a Tenant switch forget them. A new tab starts clean.

Remembering across sessions was rejected. A filter left from the day before would narrow the next morning's list without the office noticing.

### What is remembered

- The view is remembered: a chip, "Za fakturiranje", or a view opened from Home that has no chip.
- The search and the six filter fields are remembered.
- The day is not. The menu opens the current operational day. The day band is navigation, not a filter (ADR-0060), and a remembered day would cross the operational-day start.
- The open Ride is not. A panel does not open by itself after a navigation.
- A link that carries its own query, from Home, a Ride history, or the command palette, replaces the remembered state whole and becomes the new remembered state. It is not merged: a Home count of unassigned Rides must not open a list narrowed by a remembered Driver.
- A reload and Back or Forward follow the address, as today.
- `+ Novi transfer` does not change the day the form suggests (#565).

### Where it is kept

The state is in `sessionStorage` under `transferpro-transfer-filters:{tenantId}:{userId}`, the key shape of the occupation strip. It holds the view, the search, and the six fields under their address keys, without `day` and `ride`. Every read goes through Zod and the address parsers. A value that does not parse is ignored and removed.

It is written on every change of the view or a filter, "Očisti filtre" included. Arriving at `/transfers` with none of the screen's address keys restores it with `router.replace`, after mount, so a reload and Back work from the address. Arriving with any of them (`day`, `filter`, `search`, `client`, `driver`, `vehicle`, `partner`, `rideState`, `attention`, `ride`) is a link. "Idi na dan…" from the palette therefore clears the filters too. The menu links stay bare.

Sign-out, the idle sign-out, and every successful sign-in remove every key with that prefix in the tab, so the twelve-hour end of a session leaves nothing behind either. A Tenant switch removes the key of the Tenant left. The draft keeps its own rules (ADR-0038, ADR-0057).

The search may hold a guest's name. It stays in one tab and goes at sign-out, which is narrower than the draft, kept for up to 24 hours.

An id that no longer matches a record is restored as it is and shown as ADR-0060's "Nepoznat …" tag, which can be removed, as for an old link.

### Clearing, and when this ships

This decision adds no clear action. "Očisti filtre" comes from ADR-0060: in the summary it clears the filters and keeps the view, and in the empty state it clears both. Either clear changes the remembered state, because that state is the last one. Remembering ships only after #564, so that a remembered filter is always visible as a tag, with a clear beside it.

### What the counts follow

Every view count follows every active filter, the search included, and never the chosen view. Views are alternatives, so counting one inside another would leave the other chips at zero.

"Hitno (n)" counts every Ride of the shown operational day, whatever is filtered, because nothing may hide an urgent item (ADR-0039). When filters hide urgent Rides, ADR-0060's line "Hitno skriveno filtrima: {count}." explains the difference. The code already does this. A test adds the Driver filter case.

### The Početna badge

The badge counts every urgent Ride of any day, the Rides in Pozornost, and follows no filter and no screen (ADR-0039). "Hitno (n)" counts the shown day. The two answer different questions, anything urgent anywhere and anything urgent on this day, and both stay. Counting only the current operational day was rejected, because an unclosed mark from an earlier day would drop out of the badge.

## Consequences

The office can go to Home and come back to the same view and filters. The cost is a filter that outlives the screen it was set on. #564's tags and "Prikazano" make it visible, which is why remembering waits for #564.

A link with its own query discards the remembered filters, "Idi na dan…" included. A duplicated browser tab copies `sessionStorage`, so it starts with the same filters. That is accepted.

A badge larger than "Hitno (n)" is normal. If the pilot shows that it confuses the office, a later small ticket after #564 may add a line on Transfers for urgent Rides on other days, with a link to Home. The Home read is already loaded on every office screen, so it needs no new read.

### Superseded

ADR-0038: "There are no saved views; a link with its filters serves that purpose." There are still no saved views, and a link with its filters still opens them. The view and the filters are also remembered for the working session in one tab, and a link with its own query replaces them.
