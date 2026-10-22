# 206 Step 2 language grill

Out of scope: code and migrations. The grill closed on 22.10: the owner accepted Q6a–Q6e as recommended, and ADR-0054 is accepted. Tickets T1–T4 are filed by the owner.

## Decisions

- #206 step 2 was settled on 14.10 by ADR-0003, ADR-0036, and `GLOSSARY.md` (PR #230). This re-grill on 22.10 found no drift in the code: no Order term, `channel` + `external_id` with the unique key, `client_reference` on Transfers, `partners` as its own module, Podizvođač in the Croatian UI, and the import boundaries of ADR-0034 and ADR-0036.
- Q1: step 2 is marked Done 14.10, and deadline risk 6 is struck. The owner edits the #206 body; the agent does not.
- Q2: the #206 body is rewritten to read Transfer where it says order, with the replacement text given to the owner.
- Q3: a Price is always what the Client is charged. A subcontractor's cost is post-v1. Step 24 reads "a price per Client", and its ADR drops Partners from ADR-0036's `price-list` sentence. `GLOSSARY.md` gains **Price**.
- Q4: Transfer is Transfer in Croatian, and Ride is Vožnja, in `GLOSSARY.md`.
- Q5: step 5 leaves the route. There is no BookingSource port in v1 (ADR-0035). The owner closes #227 as not planned.
- Q7: a Transfer whose Price is 0 is never invoiced and is not listed under "Za fakturiranje". It is in ADR-0053, which supersedes ADR-0051's sentences on what may be invoiced and on the "Za fakturiranje" filter, and in the glossary entry for **Invoice**. It goes into the #435 spec before #439 starts.

## Q6, a group in several vehicles

The reference operator answered: one booking with the group's total price, plus a linked extra vehicle with no sales price, billed once; both vehicles on the schedule, a work order per Driver, and a shared booking reference. How often groups split, and whether one group's vehicles can differ in time or place, stay unknown. The owner chose a Price-0 extra vehicle with an explicit link. ADR-0054 is accepted and partially supersedes ADR-0009, ADR-0020, ADR-0026, and ADR-0051. `GLOSSARY.md` gains Main Transfer, Extra vehicle, and Group, and the Transfer, Work order, and Client reference entries follow ADR-0054.

Settled from the docs and the code, not asked:

- **Link.** One nullable column on the extra vehicle's row naming its main Transfer, a composite foreign key on the Tenant, a check that it is not its own row and that the Price is 0, an index for the group read. No new table, rewrite, or `UPDATE`. Set at create, never changed. One level, checked under the main Transfer's row lock, no trigger (ADR-0035 precedent).
- **Group passenger count.** Derived, not stored: the main Transfer plus its extra vehicles whose Ride is not cancelled. Storing the total on the main Transfer would show its Driver the wrong count.
- **Work order per vehicle.** Each extra vehicle is a Transfer with its own Ride (ADR-0005 stands), so assign, change, clear, cancel, capacity, Popunjeno, live flight, and the version work unchanged. No new mail kind.
- **Billing.** ADR-0053 keeps every extra vehicle uninvoiced; the main Transfer is invoiced when its own Ride is done. No Vehicle count on the invoice (the owner's rule).
- **No unlinked Price 0 by copy.** Duplicate and return journey are not offered on an extra vehicle.

Decided by the owner, as recommended:

- **Q6a, names.** Main Transfer / Glavni transfer, extra vehicle / Dodatno vozilo, group / Grupa.
- **Q6b, the shared booking reference on the Driver's side.** The Client reference, copied at create, stated on every work order and Driver card when set, with a group mark; a Client reference change becomes a changed fact (supersedes two ADR-0026 sentences).
- **Q6c, changing the main Transfer.** No propagation to extra vehicles; a notice on save when the pickup, a place, or the flight changes; the Ride detail lists the whole group. Fits the unknown "can they differ".
- **Q6d, cancelling the main Transfer.** Refused with 409 while an extra vehicle is unfinished; extra vehicles are cancelled first.
- **Q6e, the passenger count on the invoice line.** Always: the group's count, or the Transfer's own when it has no extra vehicle (supersedes one ADR-0051 sentence).

Several Rides per Transfer stays possible after v1 with its own ADR, if groups turn out to be frequent.

## Chore

- `i18n/locales/hr.json` `closed` says "Rezervacija nije promijenjena." and `en.json` says "The booking was not changed." Every other string says transfer. Fix to "Transfer nije promijenjen." and "The transfer was not changed." in a separate small chore, not in this branch.
