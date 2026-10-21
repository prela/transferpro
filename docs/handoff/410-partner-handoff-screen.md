# 410 Hand a Ride off to a Partner: screen

Out of scope: Partner capacity (`ride_unavailable`, `fully_booked`) and a Partner row on the occupation strip stay in their later tickets.

## Decisions

- QC accepted the day-list menu commands, the duplicated partner label, the 400/403 assignment sentences, and the thin `canHandOff` guard.
- A handoff from an assigned or accepted Ride states that the Driver and the Vehicle are cleared, in Croatian and English. An unassigned handoff does not.
- The detail bar stays one primary action and Više. A handed-off Ride's facts name the Partner and omit Driver and Vehicle.
- No migration and no new command. The screen uses the #409 routes and does not send `confirm`.
- The reports below are verbatim, before the confirmation sentence.

## Code review

## Standards

### Hard

**`app/components/TransferRideDetail.vue` — a handed-off Ride is labeled unassigned.** Driver and vehicle fall back to `transfers.unassignedCrew` (`Nedodijeljeno`) whenever the id is null. A handed-off Ride has neither, so those lines say unassigned while the state line says Predano podizvođaču. ADR-0048: the board stops calling it unassigned. `GLOSSARY.md` Unassigned is a Ride with no Driver, no Vehicle, and no Partner. The row in this same diff avoids that label (`crewText` returns the Partner).

**`TransferRideDetail.vue` action bar — a second command beside the one primary.** For `unassigned` / `assigned` / `accepted` the bar shows the primary (Dodijeli, Potvrdi telefonom, or Obavljeno) and `ride.handOff`. For `handed_off` it shows Obavljeno and `ride.changePartner`, then Više. ADR-0038 Ride detail: the phone bar holds one primary action and Više. The row menu is the place those commands already go.

### Judgement

**Duplicated code.** `partnerLabel` is the same function in `TransferRideRow.vue` and `TransferRideDetail.vue`. The new menu branches (`canHandOff`, `canChangePartner`, `canTakeBack`) are the same cascade in both files.

**`RideHandOff.vue` — 400/403 copy is the assignment sentence.** `failureKey` maps those statuses to `ride.rejected` and `ride.forbidden`.

**`RideHandOff.vue` — no consequence when the handoff clears a Driver.** ADR-0038: a confirmation for a command that unassigns states the consequence. ADR-0048 says a handoff from `assigned` or `accepted` clears the Driver and the Vehicle. Take-back does state its consequence.

**`app/transfer-ride-guards.ts` — Middle man.** `canHandOff` only returns `canHandOffRide(ride.state)`.

## Spec

**(a) Missing or partial**

None against the acceptance criteria. The Ride detail has "Predaj podizvođaču" with a Partner picker (phone list, desktop select), a Partner change, take back, and done, No-show, and cancel. The status and the Transfers state column use "Predano podizvođaču". The office home count is in the day balance, the e2e checks that the parts still sum to the ride total, and that count opens `filter=handedOff`. Croatian and English strings are both present. The e2e covers hand off, change, take back, and close as done, with Croatian copy, one English smoke, light and dark, phone and desktop, and axe. No test is removed or weakened.

**(b) Scope**

The day-list overflow also starts hand off, a Partner change, and take back. Spec: "on the Ride detail, \"Predaj podizvođaču\" with a Partner picker, a change of Partner, take back, and the close actions".

**(c) Wrong**

On a handed-off Ride the detail still shows Driver and Vehicle as "Nedodijeljeno" / "Unassigned" (`transfers.unassignedCrew`). Glossary, Handed off: "It has no Driver and no Vehicle." ADR-0048: "A handed-off Ride is not unassigned". Spec: "On the Ride detail the office sees \"Predano podizvođaču\"".
