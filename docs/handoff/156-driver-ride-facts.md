# 156 Show the Driver the full Ride facts

Out of scope: a detail screen, an image or upload, editing a Transfer after create, and changing the cash-only price rule.

## Decisions

- The phone payload adds `clientName`, `clientKind`, `fromAddress`, `toAddress`, `luggageCount`, `childSeatCount`, `note`, `tabla`, and `registrationPlate`. Addresses, the note, and the tabla are null when absent. A stored blank tabla (`''`) becomes null on the phone. Counts stay numbers at zero. Catalog ids stay off the payload.
- The upcoming read loads the Client, both Locations, and the Vehicle by id through each module's `index.ts` (`loadClient`, `loadLocation`, `loadVehicle`). `loadVehicle` returns an archived Vehicle. Those reads do not apply the office role check. `listUpcomingRides` still requires a Driver.
- A missing Client, Location, or Vehicle becomes the existing fixed failure `Driver ride read failed`. The card shows only `driverRides.loadFailed`.
- Labels reuse the existing Client, kind, address, luggage, child-seat, note, plate, and tabla strings. Croatian tabla is Tabla. English is Meet sign.

## Code review

Fixed point `origin/develop` (`bdb9607`). Reviewed commit `7e77642`. Diff `git diff origin/develop...HEAD`. Both subagents started with `fast=false`. The Task tool has no `fast` parameter; the prompts set `fast=false`.

Follow-up after the review, not part of the reports below: the card Ride now stores an address on both Locations; the English and dark assertions reject `99.00 EUR`; `PlaceLine` was renamed to `LocationLine`.

## Standards

`7e77642` against `origin/develop`. ADR-0009 and ADR-0020 hold: cash still shows the price and the method; card and invoice to agency still send and render neither. Catalog reads go through each module's `index.ts`. The upcoming route still calls `driverOnly` inside `withTenantFromSession`. Locale keys already exist in both files. No new log line.

### Documented

**Hard — `AGENTS.md` (Workflow): never weaken or remove a test; flag it.** `e2e/driver-rides.spec.ts` deletes `cardCard.getByText('99.00')` in the English block and again after the dark-theme switch. The note fixture is `Voucher fare 99.00`, so that substring had to go, but nothing replaces it with the formatted fare (`99.00 EUR`). Croatian still asserts `99,00 EUR` is absent, and `Price` is absent. A leaked English amount with no "Price" label would pass.

**Same rule, retargeted (not a hole).** `upcoming.rls.test.ts` changes `not.toContain('99.00')` to `not.toContain('"price":"99.00"')` and `'card'` to `'"card"'`. The price field and `toMatchObject({ price: null, payment: null })` still pin ADR-0009. The cross-tenant guest-name check is unchanged.

**Naming — `GLOSSARY.md` (Location, avoid "place") and `AGENTS.md` (use glossary terms in code).** New names in `driver-ride-access.ts`: `PlaceLine`, `placeLine`, `places`, and `const place = await loadLocation(...)`. The comment in `DriverRides.vue` says "An archived place". These are Locations.

### Judgement

**`AGENTS.md` (Security): a loader that returns tenant data enforces the role allow-list itself.** `loadClient` and `loadVehicle` say they skip the office check because the caller already required a Driver. `listUpcomingRides` does call `driverOnly` before them, and `loadLocation` is already that shape. Not a new route hole. The new public exports still rely on the caller.

**Duplicated code.** `placeLine`, `clientLine`, and `plateOf` are the same cache: get, load, set. `clientLine` and `plateOf` repeat that shape.

Shotgun edits across clients, vehicles, the lint gate, and transfers follow ADR-0018 and the index-only import rule, so that smell is suppressed.

## Spec

### (a) Missing or partial

No acceptance criterion from #156 is missing. The card, the phone payload, catalog reads by id, the cash rule, list membership, and the fixed failure all match the 10.10 implementation decisions.

Partial against Testing Decisions: "The other card shows the Client, both addresses when stored". Both the route fixture and the phone fixture store an address only on the end Location (`fromAddress: null`, `toAddress: 'Masarykov put 1'`). A start address is never stored, so two address rows on one card are not shown. The template does render `fromAddress` and `toAddress` as separate rows, and a null address is omitted.

### (b) Scope creep

Testing Decisions: "It does not assert private query shape. It checks the facts on the response and on the screen." `driver-rides.test.ts` now asserts that the SELECT text contains `client_id`, `luggage_count`, `child_seat_count`, `note`, `tabla`, and `vehicle_id`. The route test and the phone test do check the facts on the response and the screen.

No detail route, no cash-rule change, no note redaction, no image, and no catalog ids on the payload.

### (c) Implemented but wrong

None. Client name and kind (including an external Driver in the route test), archived Location name and address, archived plate with no archived mark, zero counts, full note including a fare, tabla omitted when empty (`Tabla` / `Meet sign`), and card and invoice fares absent from the response all match the quoted rules. A missing catalog row still becomes the existing fixed failure `Driver ride read failed`, and the card shows only "The rides could not be loaded."
