# An extra vehicle linked to its main Transfer

Status: accepted

Damir accepted this on 22 October 2026, in the step 2 re-grill of #206 (Q6), after the reference operator's answer, and revised it on 23 October 2026 before it merged: a whole group is cancelled from its main Transfer, the group's ordered passenger count is stored, and a correction of the main Transfer can be applied to its extra vehicles. It partially supersedes ADR-0009, ADR-0020, ADR-0026, ADR-0046, and ADR-0051; the sentences are named below. ADR-0005 stands: every Transfer still has exactly one Ride. ADR-0053 stands and carries the billing.

## Context

A group too large for one Vehicle is one booking for the Client. The owner's rule is that the Client is invoiced once for the service, and how many Vehicles carry it is the Tenant's concern. The reference operator asked, for v1, for one booking with the group's total price, plus a linked extra vehicle with no sales price of its own. Both vehicles are on the schedule, each Driver gets their own work order, and both carry a shared booking reference. How often groups split, and whether the vehicles of one group can have different pickup times or places, are unknown; there is no data on either.

Several Rides per Transfer would reopen ADR-0005 and rework the correction, capacity, live flight, and the version for sibling Rides. An extra-vehicle Transfer with no link cannot be cancelled, corrected, or invoiced as part of its group. A shared group id written on every member would not say which member carries the price. A group passenger count summed from the vehicles would change the invoice whenever the office moves passengers between vehicles, although the Client ordered the same service.

## Decision

### Terms and storage

The **main Transfer** carries the group's Price and the group's ordered passenger count. An **extra vehicle** is a Transfer linked to one main Transfer, with a Price of 0. A main Transfer and its extra vehicles are a **group**. In Croatian they are Glavni transfer, Dodatno vozilo, and Grupa.

The link is one nullable column on the extra vehicle's Transfer row, the main Transfer's id, with a composite foreign key on the Tenant. A check holds that it never names its own row and that a linked Transfer's Price is 0. The link is set when the extra vehicle is created and never changes. A main Transfer cannot itself be an extra vehicle; the create checks that under the main Transfer's row lock, with no trigger.

The group's ordered passenger count is a second nullable column on the Transfer: how many passengers the Client booked for the whole group. A check holds that it is empty on an extra vehicle and, when set, lies between 1 and a group maximum that the spec names, above the 60 of one Transfer. Empty means the Transfer's own passenger count. It has no column default, because a default cannot read another column and a stored copy would drift when the passenger count is corrected. It is set when the first extra vehicle is added and is never cleared, so a main Transfer whose extra vehicles are all cancelled keeps it.

Each Transfer keeps the passengers its own Vehicle carries, and that is the count its Driver sees. Adding, removing, or cancelling an extra vehicle never changes the group's ordered passenger count. Only a correction of the main Transfer does.

Both columns arrive with no default, no table rewrite, and no `UPDATE`.

### Creating an extra vehicle

The office adds an extra vehicle from a main Transfer, or from an extra vehicle on behalf of its main Transfer, while the main Transfer's Ride is unassigned, assigned, accepted, or handed off. The form starts from the main Transfer: the Client, the pickup, the start and end Locations, the flight number, the airport mark, the guest, the tabla, the Client reference, and the payment. The passenger, luggage, and child-seat counts and the note start empty. The Price is 0 and cannot be changed. It is an ordinary Transfer create with its own ExternalRef (ADR-0035), so a repeated entry returns the existing extra vehicle. The audit entry `transfer.created` also holds the main Transfer's id. Duplicate and return journey are not offered on an extra vehicle, so a Price of 0 is never copied without its link.

When the main Transfer has no group passenger count yet, the same form asks for it, starting from the main Transfer's passenger count, and the create stores it on the main Transfer in the same transaction. That write is an office data save of the main Transfer: it takes the main Transfer's opened version, raises it (ADR-0046), and appends the main Transfer's `transfer.corrected` with that field name.

### Schedule, capacity, and the Driver

Each Transfer in a group has its own Ride, so the board, Home, capacity, occupation, Popunjeno, live flight, the stale-save version, and the work orders work for each one as they do today. Each Driver gets their own work order for their own Ride. No new mail kind is added. The group's ordered passenger count is not a work-order fact.

The shared booking reference is the Client reference, copied to the extra vehicle when it is created. Every work order and the Driver's card state the Client reference when one is set, and mark a Ride that belongs to a group. A Client reference change is a changed fact.

The main Transfer's Driver sees its price and payment as ADR-0009 and ADR-0020 say, which is the group's price. An extra vehicle's Driver never sees a price or a payment method.

### Correcting

Each Transfer of a group can be corrected on its own. When a correction of the main Transfer changes the pickup, a place, or the flight number and the main Transfer has unfinished extra vehicles, the form offers "Primijeni i na dodatna vozila". Left off, only the main Transfer changes, and the save tells the office how many unfinished extra vehicles it has.

Ticked, the same transaction writes those changed fields, and only those, to every unfinished extra vehicle. Each extra vehicle is corrected as its own Transfer would be: capacity judges it when its occupied window moves, under the one Tenant capacity lock (ADR-0034), and one confirmation covers the whole group; a new flight designator clears its landing facts (ADR-0028); an accepted Ride returns to assigned (ADR-0010); it gets its own `transfer.corrected` entry and its Driver their own changed work order. The main Transfer's opened version is checked; each extra vehicle's version is raised under its row lock and not compared. Any refusal writes nothing for any member of the group.

The Ride detail of any member lists the whole group with each pickup, places, Driver or Partner, and state. Members may differ in time or place.

### Cancelling

"Otkaži transfer" on a main Transfer with unfinished extra vehicles asks "Grupa ima još N vozila. Otkaži cijelu grupu?". On confirm, one transaction cancels the main Transfer's Ride and the Ride of every unfinished extra vehicle, each with its own cancel audit entry and its Driver's cancelled work order. Cancelling a main Transfer always takes its unfinished extra vehicles with it; there is no refusal for them. The Transfer rows are locked main first, then the extra vehicles. Like every office cancel, it does not change the version (ADR-0046).

An extra vehicle can be cancelled on its own. The main Transfer, its group passenger count, and its billing stay. Closing the main Transfer's Ride as done or a No-show is not limited by its extra vehicles.

### Billing

An extra vehicle is never invoiced and never listed under "Za fakturiranje" (ADR-0053). The main Transfer is invoiced once, when its own Ride is done, whatever its extra vehicles' state. The invoice names no Vehicle count. The line states the group's ordered passenger count, which for a Transfer that never had an extra vehicle is its own passenger count.

### Superseded

ADR-0009: "We will show the Driver the price and the payment method when payment is cash." An extra vehicle's Driver sees neither, whatever its payment.

ADR-0020: "it will show the price and the payment method only when payment is cash." The same: an extra vehicle hides both.

ADR-0026: "It then states the departure, the pickup, the drop-off, the guest name, the tabla, the passenger count, the luggage count, the child-seat count, the flight number when one is recorded, the client, the vehicle name and plate, and the note." It also states the Client reference when one is set, and marks a Ride that belongs to a group. An extra vehicle has no payment line, whatever its payment.

ADR-0026: "A real change uses changed: pickup time, pickup place, drop-off, flight number, guest name, passenger count, luggage, child seats, airport mark, tabla, note, vehicle, client, payment method, and the price while payment is cash." A Client reference change also uses changed.

ADR-0046: "Those commands take the version the form was opened with." A correction applied to a group's extra vehicles takes the main Transfer's opened version only; each extra vehicle's version is raised and not compared.

ADR-0051: "The line text is the Tenant's line text, the start and end Location names, the pickup date in the Tenant's time zone, the Client reference when there is one, and the guest name only when the Client's billing details ask for it." The line text also states the group's ordered passenger count.

## Consequences

The Client is invoiced once for the whole group, for the passengers it ordered, however the office spreads them over Vehicles. Swapping the main Transfer to a larger Vehicle and cancelling the extra vehicle leaves the invoice as it was. ADR-0005, capacity, and live flight stay as they are; each vehicle tracks its own copy of the flight, so every Driver hears of a delay. The migration adds two nullable columns.

A correction applied to the group and the group cancel are the first commands that write several Transfers at once. They lock the main Transfer first and the extra vehicles after it. An office member editing an extra vehicle while the main Transfer's correction is applied to it gets `stale_save` on their next save, and the pickup, places, and flight they had saved are overwritten by the main Transfer's.

A correction left on the main Transfer does not reach its extra vehicles, so the members may drift apart; the group list on the Ride detail is where that shows. A Client change on the main Transfer leaves the extra vehicles with the old Client, which affects only that Client's Ride history.

A main Transfer cancelled by mistake takes its group with it, and none of it can be revived (ADR-0005). If the main Transfer's Ride ends as a No-show while an extra vehicle is done, nothing is invoiced; the office corrects that by hand.

If groups turn out to be frequent, several Rides per Transfer can still replace this link with its own ADR.

## Amendment (2026-10-28, #543)

The offer "Primijeni i na dodatna vozila" starts ticked when the main Transfer has unfinished extra vehicles. The office can still leave it off, and then only the main Transfer changes. The save notice that names those extra vehicles links to the group list on that Ride's detail. Nothing else in this decision changes.
