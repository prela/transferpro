# 206 Step 2 language grill

Out of scope: code, migrations, and ADR-0053. The grill stays open until Q6 is decided.

## Decisions

- #206 step 2 was settled on 14.10 by ADR-0003, ADR-0036, and `GLOSSARY.md` (PR #230). This re-grill on 22.10 found no drift in the code: no Order term, `channel` + `external_id` with the unique key, `client_reference` on Transfers, `partners` as its own module, Podizvođač in the Croatian UI, and the import boundaries of ADR-0034 and ADR-0036.
- Q1: step 2 is marked Done 14.10, and deadline risk 6 is struck. The owner edits the #206 body; the agent does not.
- Q2: the #206 body is rewritten to read Transfer where it says order, with the replacement text given to the owner.
- Q3: a Price is always what the Client is charged. A subcontractor's cost is post-v1. Step 24 reads "a price per Client", and its ADR drops Partners from ADR-0036's `price-list` sentence. `GLOSSARY.md` gains **Price**.
- Q4: Transfer is Transfer in Croatian, and Ride is Vožnja, in `GLOSSARY.md`.
- Q5: step 5 leaves the route. There is no BookingSource port in v1 (ADR-0035). The owner closes #227 as not planned.
- Q7: a Transfer whose Price is 0 is never invoiced and is not listed under "Za fakturiranje". It is in the glossary entry for **Invoice**, and goes into the #435 spec before #439 starts. ADR-0051 is accepted and not edited; its invoiceable sentence is superseded by the Q6 record.

## Open: Q6, a group in several vehicles

Waiting on the reference operator's answer. The owner's rule: the agency ordered transport for the whole group and is invoiced once for that service; how many Vehicles carry it is the Tenant's concern. Two invoices for one group are rejected.

- **A, several Rides per Transfer.** One Price, one invoice, a Driver and a Vehicle per Ride. Reopens ADR-0005's "exactly one Ride in v1", which #206 lists as locked, and amends ADR-0028, ADR-0029/0034, ADR-0046, and ADR-0051. About 8 implement tickets, 4–5 high, 1–2 migrations: drop `rides_transfer_id`; add and remove a vehicle; the correction over several Rides (closed rule, capacity per Ride, return to assigned, work orders, the audit entry's single `rideId`); the flight memory, because `expected_arrival_basis_at` and `flight_will_not_arrive_handed` sit on the Transfer and a second Driver would never be told; one version for sibling Rides; the price once on the board, the CSV export, and the Ride history; one Driver collects cash. Collides with the open #358 in the same files.
- **B, an extra-vehicle Transfer linked to the first.** A nullable `lead_transfer_id` (migration, high), a badge and a "Dodatno vozilo" action, no cash price on the extra, an extra is never invoiced, and a rule for cancelling the first. 3 tickets, 5 if corrections propagate. When A lands, stored extras must become Rides of their first Transfer, or two models stay.
- **C, a duplicate at Price 0, tied only by the Client reference.** No migration. A third prefill kind in `shared/transfer-prefill.ts`, and "bez naplate" instead of 0,00 € for cash at 0 on the Driver's card and work order, as one medium ticket. Relies on Q7. The invoice of the priced Transfer must show the whole group's passenger count (for example 12), not only its own van. ADR-0051's line text has no passenger count today, and with no link the group's total cannot be summed from the extras (an arrival and its return journey share the Client reference), so C must also decide where that total is kept. No read sums passenger counts today. Risks: a forgotten Price 0 (invoices are issued by hand, one at a time), drift when only one Transfer is corrected, and a cancelled priced Transfer whose Price the office must move by a correction before invoicing.
- The agent recommended A after v1 with C as the v1 bridge. Not decided.

## Chore

- `i18n/locales/hr.json` `closed` says "Rezervacija nije promijenjena." and `en.json` says "The booking was not changed." Every other string says transfer. Fix to "Transfer nije promijenjen." and "The transfer was not changed." in a separate small chore, not in this branch.
