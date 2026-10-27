# Stops and an escort on one Transfer

Status: accepted

Damir accepted this on 27 October 2026, in the multi-pickup grill. Damir decided the scope questions: stops belong to one booking, and a stop is a place where guests board or alight. The remaining questions were resolved by the product owner. It partially supersedes ADR-0007, ADR-0010, ADR-0026, ADR-0029, ADR-0034, ADR-0038, ADR-0052, and ADR-0055; the sentences are named below. ADR-0005 stands: every Transfer has exactly one Ride. ADR-0036 stands: the Transfer is the order. ADR-0054 stands: a group too large for one Vehicle is a main Transfer and its extra vehicles. ADR-0028 and ADR-0051 stand unchanged.

This is a post-v1 feature. It is not everyday work, and no ticket exists yet. The superseded sentences take effect when the first slice lands. A Transfer with no stops and no escort behaves under the new sentences exactly as under the old ones.

## Context

A Transfer has one pickup time, one start Location, and one end Location, all required (`pickup_at`, `start_location_id`, `end_location_id`). Every clock reads them: the occupied window and the capacity judge, the unclosed mark, in progress, the unassigned alarm, the operational day, the No-show wait, and the live flight. A Driver sometimes collects guests of one booking at several hotels, or drops an arriving group at several hotels. Some vehicles also carry an escort: a representative, a guide, or a porter. An escort takes a seat, has no price, and is not a passenger.

Two cases from the reference operator, without names:

- An agency sends 121 guests from five hotels to the airport: 40 at hotel 1, 4 at hotel 2, 36 at hotel 3, 26 at hotel 4, and 15 at hotel 5. The dispatcher sends one bus to hotels 4 and 5, which are close and fit one bus; one bus to hotel 3; one bus to hotel 1; and a van to hotel 2, which is off the way, so that a full bus does not turn off for four guests. The dispatcher sets each departure time. Some vehicles carry a representative or a porter, some do not. Picking up an escort does not move a departure time. The Driver needs a note of who joins, where, and when, if anyone does.
- Hotel 3 has 60 guests, hotel 4 has 10, and hotel 5 has 7. Bus 1 goes straight to hotel 3 and takes most of its guests. Bus 2 goes to hotel 4, then hotel 5, then hotel 3 for the rest, then the airport. The same hotel is a pickup in two vehicles of one group, and one vehicle has three places where guests board.

An arriving group is the mirror case: the airport, then hotel 4, then hotel 5.

The strongest objection was that several pickups might be several guests or several Clients sharing a vehicle, which would be several Transfers. Moving every Transfer to a list of points would lose the plain start and end that every clock reads, and would rewrite every stored Transfer. A Vehicle has no seat count, and Capacity is about time, not seats (ADR-0034).

## Decision

### Scope: one booking

Stops belong to one booking: one Client, one Price, one payment, one invoice, one Ride, and one outcome. They are the itinerary of that one Transfer. A booking that needs several Vehicles stays a group (ADR-0054), and each vehicle is its own Transfer with its own stops. In the first case the group is four Transfers, and only the bus to hotels 4 and 5 has a stop. Different Clients or different bookings sharing one Vehicle, a shuttle, are not this decision; they stay separate Transfers, and a shuttle is a later ADR of its own.

### Terms and storage

A **stop** is a Location the Ride passes between its start and its end, where guests board or alight. The **itinerary** is the start, the stops in order, and the end. An **escort** is a person the Client sends along in one Vehicle, such as a representative, a guide, or a porter. In Croatian they are Stanica, Itinerar, and Pratnja.

The three Transfer columns stay as they are: `start_location_id` is the first place, `pickup_at` is the time there, and `end_location_id` is the final destination. A new tenant table holds only the stops, one row per stop: the Transfer, the position, the Location, the direction (guests board or alight), the minutes after the first place, an optional passenger count, and an optional stop note. A Transfer with no rows is a Transfer with one pickup, as today. The table arrives with no backfill and no `UPDATE`, as in ADR-0054.

The table has `tenant_id` from the session, `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy with `USING` and `WITH CHECK`, and `REVOKE ALL FROM PUBLIC`. Composite foreign keys on the Tenant refuse another Tenant's Transfer and another Tenant's Location. An RLS test proves that Tenant A cannot read or write Tenant B's stops. This record is the ADR that allows `DELETE` on that table, only inside a Transfer create or correction that replaces its stops. A Transfer and a Ride are still never deleted.

The escort is one nullable free-text column on the Transfer, with no default and no backfill. It holds who joins, where, and when, for example "the representative joins at hotel 4 at 07:40; the porter from hotel 5". It may hold a name or a phone number, so it follows the rules of the note: the audit entry records only the field name, and the logs redact it. The stop note follows the same rules. The audit entry for stops records the field name `stops` and never a place.

The stops and the escort are Transfer data under the Transfer's version (ADR-0046). A change to either raises the version, and a stale save is refused.

### Time of a stop

Every stop has its minutes after the first place. They are required, at least 0, and do not decrease in stop order. The office enters and sees an instant: `(landing_at ?? pickup_at)` plus the minutes. Correcting the pickup or recording a landing moves every stop with it. The end has no minutes of its own.

The occupied window opens at the pickup and ends at `(landing_at ?? pickup_at)` plus the last stop's minutes plus the transfer duration. With no stops, the last stop's minutes are 0. Capacity, the overlap and relocation-gap warnings, unavailability, fully booked, and the unclosed mark follow that end because they read it; none of them is changed on its own.

The unassigned alarm, unassigned past pickup, in progress, the operational day, and the live flight stay on the first place and its pickup time.

### Counts

A stop's optional count says how many guests board there, or alight there. The optional stop note says which guests, for example "the rest of the group". The counts are not summed, not compared, and do not warn. `passenger_count` stays the guests in the Vehicle and the only count a rule reads: the limits, the Driver's total, and the group's ordered passenger count of ADR-0054.

Every guest boards at the start or at a boarding stop, and leaves at the end or at an alighting stop. The work order and the Driver's card therefore show a count at the start, `passenger_count` minus the boarding stops' counts, and at the end, `passenger_count` minus the alighting stops' counts. Each derived count is shown only when every stop in that direction has a count and the result is at least 1. It is not stored. For bus 2 with 27 guests, 7 at hotel 5 and 10 at hotel 3, the start shows hotel 4 with 10.

### Escort

The escort is not a passenger, has no price, and moves no time and no window. It is on the Transfer, so each vehicle of a group has its own. The Driver sees the whole text on the card and in the work order. A Partner gets no mail (ADR-0048); the escort and the stops are on the day print, which the office passes to the Partner itself.

### Validity

These rules hold in the shared Zod schema at the API boundary, not only in the form:

1. Two neighbouring points of the itinerary are different Locations. A Location may appear again further on.
2. The start and the end are different Locations, with or without stops. A round tour is not a Transfer.
3. A Transfer has at most 10 stops.
4. An archived Location cannot be added as a new stop. A stop whose Location is archived later stays.
5. The minutes are required, at least 0, and do not decrease in stop order.

A stop may be an airport Location. It gets no flight tracking and no airport wait.

### Flight

The flight number, the airport mark, the landing time, the expected arrival, and the airport wait stay facts of the start. On an arrival with alighting stops, the flight is tracked as today and a landing moves every stop. On a departure, the flight number stays a note, as today. Two flights in one Vehicle stay two Transfers, or an extra vehicle of the group.

### Re-acceptance and the work order

A change to the stored itinerary returns an accepted Ride to assigned (ADR-0010). The stored itinerary covers adding or removing a stop, and a change to its Location, direction, position, or minutes. A change to a stop's count or note, or to the escort, does not. A landing that moves the instants of the stops does not either, as a landing does not today. The stops join the route fields as one field, `stops`.

Every change to the stops, including a count or a note, and every change to the escort, is a changed fact for the work order.

### Groups

An extra vehicle's form does not copy the main Transfer's stops or escort. "Primijeni i na dodatna vozila" (#468) never writes stops. A change to the main Transfer's stops alone does not offer it; in ADR-0054, "a place" means the start or the end.

### No-show

The Ride keeps one outcome. It is done when any guest travelled. It is a No-show when no guest boarded at the start or at any boarding stop. A stop where nobody boarded is written in the stop note or the Transfer note, and nothing is charged.

On a Transfer with at least one boarding stop, the Driver may mark a No-show only after the last boarding stop's instant plus the elsewhere wait, whether or not the start is an airport. A Transfer with no boarding stop, including an arrival with only alighting stops, keeps today's wait. The office's early No-show is unchanged. "Nedolazak" names the new window because it reads the same bounds.

### Copying

A duplicate copies the itinerary whole, with the Location, direction, minutes, count, and note of each stop, and copies the escort, as it copies the note. A return journey copies neither the stops nor the escort. An extra vehicle copies neither. All three only fill the form (ADR-0038).

### Showing it

The work order, the Driver's card, and the day print list the itinerary in order: each point with its instant, its Location, whether guests board or alight, its count (derived at the start and the end), and its note. The escort is its own line. A board row stays short: the start, "+N stanica", the end, and a mark when there is an escort.

The Ride detail has a "Prikaži na karti" button for each stop, under the rules of ADR-0052 for the start and the end. The Driver's phone has a directions link for each point of the itinerary, in order.

The price list, once built, suggests a Price from the start and the end only. The office corrects the Price by hand when stops cost more. The invoice line keeps the start and end Location names, of the main Transfer in a group, and names no stop (ADR-0051).

### Glossary

`GLOSSARY.md` changes when the first slice lands, because until then a Transfer has no stops and no escort. The proposed text:

- **Stop** (new): "A Location a Ride passes between its start and its end, where guests board or alight. It has a time, set from the pickup, so it moves with the pickup and the landing. It may say how many guests board or alight there, and which. In Croatian it is Stanica." _Avoid_: waypoint, leg, via.
- **Itinerary** (new): "The start of a Transfer, its stops in order, and its end. In Croatian it is Itinerar." _Avoid_: route, leg.
- **Escort** (new): "A person the Client sends along in one Vehicle, such as a representative, a guide, or a porter. An escort takes a seat, has no Price, is not a passenger, and moves no time. In Croatian it is Pratnja." _Avoid_: staff, crew, passenger, guest.
- **Location**: _Avoid_ becomes "place". "stop" is a term of its own.
- **Transfer**: it also names its stops, when there are any, and an optional escort. The airport mark says whether the first pickup is an airport.
- **Transfer duration**: "The minutes a Ride occupies after its pickup, or after its landing when a landing is stored, and after its last stop when it has stops."
- **Unclosed mark**: the end of the time a Ride occupies includes its last stop's time.
- **Accepted**: changing the stops also returns it to assigned; a stop's count or note, the escort, and a landing do not.
- **No-show**: no guest boarded at the start or at any stop. With stops, the Driver marks it after the wait from the last stop where guests board.
- **Work order**: changed also covers the stops and the escort.

### Superseded

ADR-0007: "Elsewhere, the wait runs from the scheduled pickup." and "At an airport, the wait runs from the actual landing time when one is recorded, and from the scheduled pickup when it is not." On a Transfer with a boarding stop, the Driver's wait runs from the last boarding stop's instant and is the elsewhere wait. "The Driver may mark a No-show only after the wait has elapsed, and only from the state ADR-0006 allows (`assigned` when acceptance is not required, otherwise `accepted`)." The state rule stands; the wait is the one above.

ADR-0010: "We will move an `accepted` Ride back to `assigned` when the pickup time, where it starts, where it ends, or the flight number changes." A change to the stored stops does too. "Changing the Client, the passenger count, the guest name, the price, the payment, the airport mark, the landing time, or only the Vehicle does not leave `accepted`." Neither does a stop's count, a stop's note, or the escort.

ADR-0026: "It then states the departure, the pickup, the drop-off, the guest name, the tabla, the passenger count, the luggage count, the child-seat count, the flight number when one is recorded, the client, the vehicle name and plate, and the note." It also states the stops in order and the escort. "A real change uses changed: pickup time, pickup place, drop-off, flight number, guest name, passenger count, luggage, child seats, airport mark, tabla, note, vehicle, client, payment method, and the price while payment is cash." The stops and the escort also use changed.

ADR-0029: "The occupied window opens at the pickup. It ends at the landing plus the transfer duration when a landing is stored, and otherwise at the pickup plus the transfer duration." It ends at the landing, or else the pickup, plus the last stop's minutes plus the transfer duration. "A place change alone moves neither." Adding or removing the last stop, or changing its minutes, moves the end and is judged.

ADR-0034: "It answers with the Rides that are assigned, accepted, or handed off: the Ride id, the Driver id, the Vehicle id, the Partner id, the pickup, and the landing." It also answers with the last stop's minutes, 0 when there is none.

ADR-0038: "'Ispiši dan' on Transfers prints the shown day in light colours, one row per Ride with the tabla and the note, grouped by Vehicle with unassigned Rides last." Each row also carries the stops and the escort. In the Driver's card, "from and to, each with its directions link (ADR-0031)": each point of the itinerary has its directions link, and the escort is shown.

ADR-0052: "The office sees a map in two places: the Location panel, and the Ride detail, once for the start and once for the end." The Ride detail also has one for each stop. "The Driver's phone gets no map and keeps its two directions links." It keeps one directions link for each point of the itinerary.

ADR-0055: "The occupied end is the stored landing plus the Tenant transfer duration when a landing is stored, and the scheduled pickup plus that duration when no landing is stored." The last stop's minutes are added before the duration. "Recording a landing moves it to that landing plus the duration." It moves it to that landing plus the last stop's minutes plus the duration. "Clearing the landing moves it back to the pickup plus the duration." It moves back to the pickup plus the last stop's minutes plus the duration. Changing the last stop's minutes moves the instant.

## Considered options

- **Several Clients or bookings in one Vehicle (shuttle).** Rejected for this record: it is several Transfers, each with its own price and outcome, and today a second Transfer on the same Driver at the same time is a true overlap. A later ADR of its own.
- **A full table of points**, with the start and the end as rows. Rejected: it rewrites every stored Transfer and every clock, or keeps copies that drift.
- **A JSON list of stops on the Transfer.** Rejected: it has no composite foreign key to the Location, so the database would not refuse another Tenant's Location.
- **Stops in the note**, as today. Replaced: no times, counts, or map for the Driver, and no window for capacity.
- **An absolute time on each stop.** Rejected: a pickup correction or a landing would leave the stops behind.
- **A transfer duration per Transfer.** Rejected: the Driver still gets no time per stop.
- **The window left at the pickup plus the duration.** Rejected: capacity would miss the overlap.
- **The escort only in the note.** Rejected: it gets lost among other instructions, and the office cannot see on the board which vehicles carry one.
- **Escort rows with a role, a boarding place, and a time.** Rejected: no rule reads them, and the boarding place is often not a Location. A later ADR adds them when a rule needs seats or a report on escorts.
- **A stop note with no count.** Rejected: no later rule could read a number inside text.
- **A required count per stop that must sum to the passenger count.** Rejected: the sum depends on the direction and has no rule behind it. A later ADR adds it when a No-show per stop or a report per hotel needs it.
- **Only route or window changes return to assigned**, or no stop change does. Rejected: an acceptance would stand for times at a hotel that the Driver has not seen.
- **A flight per stop, or the flight on whichever stop is an airport.** Rejected: a second set of live-flight facts for a rare case. A later ADR adds it when several flights in one Vehicle become common.
- **A No-show per stop.** Rejected: nothing reads it. A later ADR adds it when No-show fees per stop or a report per hotel are needed.
- **Today's wait with an instruction to the Driver.** Rejected: one early press strands the guests at the later stops.
- **No validity rules beyond the foreign keys.** Rejected: a Driver would get an itinerary that makes no sense.
- **A round tour with the same start and end.** Rejected: an excursion differs in price, length, and waiting, and is out of scope. A later ADR when the owner brings excursions into scope.
- **A return journey that copies the stops reversed.** Rejected: departures are planned again by vehicle, so a reversed copy is often wrong. Revisit when groups more often return through the same hotels.
- **No copying at all, even on a duplicate.** Rejected: a duplicate exists so that the same booking is not typed again.
- **A route with waypoints on the map, or one directions link with waypoints.** Rejected: it changes the place mode of ADR-0052 and sends the whole itinerary to Google for a rare case. Revisit when Drivers ask for a route in the app.
- **A price-list surcharge per stop.** Rejected for now: `price-list` knows nothing of stops. A later ADR when a surcharge per stop becomes a price rule.
- **Stops on the invoice line.** Rejected: the Client is invoiced once for the service, as in ADR-0054.

## Consequences

The three Transfer columns, every clock that reads them, and every stored Transfer stay as they are. One table, one column, and the last stop's minutes in the occupied end carry the feature. The migration adds a table and a nullable column, with no rewrite and no `UPDATE`.

The stop table is the second table with a `DELETE` grant, after unavailability windows (ADR-0034). Removing a stop leaves no row behind; the audit entry shows that the stops changed, not which places they were.

A long itinerary lengthens the window, so more assignments meet an overlap warning. A late landing on an arrival with stops moves the whole itinerary and the unclosed mark, as a landing moves a Ride today.

The counts at a stop can disagree with the passenger count, because nothing checks them; the derived counts at the start and the end then disappear, and the office sees that on the work order. A guest who did not board at a stop is only text, so the Ride history counts that Ride as done.

A departing group is planned vehicle by vehicle. A main Transfer's stops never reach its extra vehicles, so the Ride detail's group list is where the office sees each vehicle's places.

The Partner learns of the stops and the escort only from the day print or from the office, as for every other fact of a handed-off Ride.

The shared schema at the API boundary already refuses the same start and end; rule 2 keeps that with stops.
