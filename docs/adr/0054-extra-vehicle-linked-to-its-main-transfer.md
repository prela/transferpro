# An extra vehicle linked to its main Transfer

Status: accepted

Damir accepted this on 22 October 2026, in the step 2 re-grill of #206 (Q6), after the reference operator's answer. It partially supersedes ADR-0009, ADR-0020, ADR-0026, and ADR-0051; the sentences are named below. ADR-0005 stands: every Transfer still has exactly one Ride. ADR-0053 stands and carries the billing.

## Context

A group too large for one Vehicle is one booking for the Client. The owner's rule is that the Client is invoiced once for the service, and how many Vehicles carry it is the Tenant's concern. The reference operator asked, for v1, for one booking with the group's total price, plus a linked extra vehicle with no sales price of its own. Both vehicles are on the schedule, each Driver gets their own work order, and both carry a shared booking reference. How often groups split, and whether the vehicles of one group can have different pickup times or places, are unknown; there is no data on either.

Several Rides per Transfer would reopen ADR-0005 and rework the correction, capacity, live flight, and the version for sibling Rides. An extra-vehicle Transfer with no link is ambiguous and cannot sum the group. A shared group id written on every member would rewrite the priced Transfer when the first extra is added and would not say which member carries the price.

## Decision

### Terms and storage

The **main Transfer** carries the group's Price. An **extra vehicle** is a Transfer linked to one main Transfer, with a Price of 0. A main Transfer and its extra vehicles are a **group**. In Croatian they are Glavni transfer, Dodatno vozilo, and Grupa.

The link is one nullable column on the extra vehicle's Transfer row, the main Transfer's id, with a composite foreign key on the Tenant. A check holds that it never names its own row and that a linked Transfer's Price is 0. No new table, no default, no table rewrite, and no `UPDATE`. The link is set when the extra vehicle is created and never changes. A main Transfer cannot itself be an extra vehicle; the create checks that under the main Transfer's row lock, with no trigger.

The group's passenger count is not stored. It is the sum of the passenger counts of the main Transfer and of its extra vehicles whose Ride is not cancelled. Each Transfer keeps the passengers its own Vehicle carries, so every Driver sees their own count.

### Creating an extra vehicle

The office adds an extra vehicle from a main Transfer, or from an extra vehicle on behalf of its main Transfer, while the main Transfer's Ride is unassigned, assigned, accepted, or handed off. The form starts from the main Transfer: the Client, the pickup, the start and end Locations, the flight number, the airport mark, the guest, the tabla, the Client reference, and the payment. The passenger, luggage, and child-seat counts and the note start empty. The Price is 0 and cannot be changed. It is an ordinary Transfer create with its own ExternalRef (ADR-0035), so a repeated entry returns the existing extra vehicle. The audit entry `transfer.created` also holds the main Transfer's id. Duplicate and return journey are not offered on an extra vehicle, so a Price of 0 is never copied without its link.

### Schedule, capacity, and the Driver

Each Transfer in a group has its own Ride, so the board, Home, capacity, occupation, Popunjeno, live flight, the stale-save version, and the work orders work for each one as they do today. Each Driver gets their own work order for their own Ride. No new mail kind is added.

The shared booking reference is the Client reference, copied to the extra vehicle when it is created. Every work order and the Driver's card state the Client reference when one is set, and mark a Ride that belongs to a group. A Client reference change is a changed fact.

The main Transfer's Driver sees its price and payment as ADR-0009 and ADR-0020 say, which is the group's price. An extra vehicle's Driver never sees a price or a payment method.

### Changing and cancelling

Each Transfer of a group is corrected on its own; a correction of the main Transfer does not change its extra vehicles. Saving a main Transfer that changes the pickup, a place, or the flight number tells the office how many unfinished extra vehicles it has. The Ride detail of any member lists the whole group with each pickup, places, Driver or Partner, and state. Members may therefore differ in time or place.

Cancelling a main Transfer's Ride while one of its extra vehicles is unfinished is refused with 409 and writes and sends nothing; the office cancels the extra vehicles first. Cancelling an extra vehicle is not limited. Closing the main Transfer's Ride as done or a No-show is not limited by its extra vehicles.

### Billing

An extra vehicle is never invoiced and never listed under "Za fakturiranje" (ADR-0053). The main Transfer is invoiced once, when its own Ride is done, whatever its extra vehicles' state. The invoice names no Vehicle count. The line states the group's passenger count, which for a Transfer with no extra vehicle is its own passenger count.

### Superseded

ADR-0009: "We will show the Driver the price and the payment method when payment is cash." An extra vehicle's Driver sees neither, whatever its payment.

ADR-0020: "it will show the price and the payment method only when payment is cash." The same: an extra vehicle hides both.

ADR-0026: "It then states the departure, the pickup, the drop-off, the guest name, the tabla, the passenger count, the luggage count, the child-seat count, the flight number when one is recorded, the client, the vehicle name and plate, and the note." It also states the Client reference when one is set, and marks a Ride that belongs to a group. An extra vehicle has no payment line, whatever its payment.

ADR-0026: "A real change uses changed: pickup time, pickup place, drop-off, flight number, guest name, passenger count, luggage, child seats, airport mark, tabla, note, vehicle, client, payment method, and the price while payment is cash." A Client reference change also uses changed.

ADR-0051: "The line text is the Tenant's line text, the start and end Location names, the pickup date in the Tenant's time zone, the Client reference when there is one, and the guest name only when the Client's billing details ask for it." The line text also states the group's passenger count.

## Consequences

The Client is invoiced once for the whole group, and ADR-0005, capacity, live flight, and every Ride command stay as they are. Each vehicle tracks its own copy of the flight, so every Driver hears of a delay. The migration adds one nullable column.

A correction of the main Transfer does not reach its extra vehicles, so the office corrects each one, and each Driver gets their own changed work order. The members may drift apart; the group list on the Ride detail is where that shows. A Client change on the main Transfer leaves the extra vehicles with the old Client, which affects only that Client's Ride history.

A whole group is cancelled one member at a time, extra vehicles first. If the main Transfer's Ride ends as a No-show while an extra vehicle is done, nothing is invoiced; the office corrects that by hand.

If the vehicles of a group turn out to always share their time and places, a correction that applies to the whole group is a later change on top of this link. If groups turn out to be frequent, several Rides per Transfer can still replace it with its own ADR.
