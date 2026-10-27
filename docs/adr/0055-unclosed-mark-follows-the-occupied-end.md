# Unclosed mark follows the occupied end

Status: accepted; partially superseded by ADR-0058

Accepted on 23 October 2026 in the unclosed-mark grill. Nikša asked for the mark 60 minutes after the planned end, and the same grill retired the landing alarm. This supersedes ADR-0030 and partially supersedes ADR-0027, ADR-0028, ADR-0038, ADR-0039, and ADR-0048; the sentences are named below. ADR-0054 stands: each member of a group is its own Transfer and its own Ride.

## Context

ADR-0027 marks an in-progress Ride 60 minutes after the scheduled pickup, and a recorded landing does not move that instant. ADR-0048 gives a handed-off Ride that same pickup clock. The mark can therefore show while the aircraft is still in the air, and while the transfer is still running. ADR-0028 leaves it there on purpose: the expected arrival is not a landing, and it does not move the mark. ADR-0030 then adds a landing alarm at the stored landing plus the transfer duration plus 60 minutes, because a landed Ride can stay unfinished after it should have ended. The two clocks answer one question at two instants.

The occupied end capacity already uses is the stored landing plus the Tenant transfer duration when a landing is stored, and the scheduled pickup plus that duration when it is not. ADR-0054 gives an extra vehicle its own Transfer, its own Ride, and its own copy of the flight. The members of a group may differ in time, place, and landing. Closing the main Transfer as done or a No-show does not close an extra vehicle. Cancelling the main Transfer does cancel its unfinished extra vehicles.

The alternatives were to keep the pickup clock and leave the end to the landing alarm; to read the expected arrival until a landing is stored; to leave an airport Ride unmarked until a landing is stored; and to mark a group once, from the main Transfer's end.

## Decision

We will mark an in-progress Ride, and a handed-off Ride, once 60 minutes have passed after its occupied end. The instant is included. The 60 minutes stay fixed for every Tenant. They are not a setting, they are not stored on the Ride, and they are not written to the audit.

The occupied end is the stored landing plus the Tenant transfer duration when a landing is stored, and the scheduled pickup plus that duration when no landing is stored. It is the same end the capacity judge uses. The expected arrival is not read. The relocation gap is not added. The airport mark is not read.

Changing the transfer duration moves the instant. Changing the scheduled pickup moves it only while no landing is stored. Recording a landing moves it to that landing plus the duration. Clearing the landing moves it back to the pickup plus the duration. When that instant is already past at the moment the Ride becomes in progress, or at the moment a handed-off Ride qualifies, the mark is on.

A main Transfer and each extra vehicle take the mark from that Ride's own occupied end. Closing one member does not clear another member's mark. A cancelled Ride takes none. There is no mark on the group.

The mark stays display only. It does not allow or refuse done, no-show, cancel, or assignment. It sends nothing. It stays urgent. An unassigned Ride and a Ride waiting on acceptance do not take it.

Where the Ride sits does not change. Only the instant does. On Home, an in-progress Ride stays on the in-progress list with the mark off until that instant, then shows in Pozornost and is not repeated on the list. A handed-off Ride is a count and not a row until that instant, then shows in Pozornost. The day board still lists the Ride on its day, with the mark on the row once the instant has passed.

We will not show a landing alarm. The unclosed mark is the sign that an in-progress or handed-off Ride was not closed, whether or not a landing is stored. There is no second urgent kind, no Pozornost group, no live-refresh key, and no mail for a landing. The short text stays "Nije zatvoreno" / "Not closed". The full text is "Prošlo je sat vremena od planiranog kraja, a vožnja nije zatvorena." / "An hour has passed since the planned end and the ride is not closed."

### Superseded

In ADR-0027, "We will mark an in-progress Ride once 60 minutes have passed since its scheduled pickup." The sentences that the 60 minutes are fixed, not a setting, not stored, and not written to the audit, stand. "A recorded landing does not move that instant. A Ride that becomes in progress after the pickup still uses the scheduled pickup, so a late assignment is marked at pickup+60."

In ADR-0027's consequences, "For the first 60 minutes the Ride is on the in-progress list with the mark off. At the instant of pickup+60 the mark is on." The Ride still sits on that list with the mark off until the new instant. And "Changing the scheduled pickup moves the instant. Changing the airport mark or the landing time does not." An unassigned Ride and a Ride waiting on acceptance still do not take it. A return to waiting on acceptance still drops it.

In ADR-0028, "ADR-0027 is unchanged: the unclosed mark stays on the scheduled pickup." The expected arrival still does not move the mark, and a Ride with no landing can still be marked while the flight is in the air.

In ADR-0030, the decision to show a landing alarm, and the consequences that keep that alarm beside the unclosed mark. A stored landing does move the unclosed mark. Clearing the landing moves it back and drops nothing else.

In ADR-0038, the short text "Alarm slijetanja".

In ADR-0039, "a landing alarm (ADR-0030)" in the urgent tier. The unclosed mark stays urgent because it is the sign that a Ride was forgotten.

In ADR-0048, "It takes the unclosed mark once the same minutes have passed since its scheduled pickup as for an in-progress Ride." A handed-off Ride still shares the one 60 minutes with an in-progress Ride.

## Consequences

A city Ride with the default transfer duration of 60 is marked at pickup plus 120 minutes. A landed Ride is marked at the landing plus the duration plus 60, and that is its only urgent mark for being unfinished. A late landing can turn a mark off until the new instant, and clearing that landing can turn it on again. Changing the duration moves marks that are already showing.

Home files that Ride under the unclosed mark. With the default duration of 60, a city Ride leaves the in-progress list for Pozornost at pickup plus 120 minutes, and a handed-off Ride stays a count until then. A refresh announces the unclosed key and not a landing key. The Hitno filter and the urgent count still count the Ride once. No mail is sent.

Each member of a group is judged from its own pickup and its own landing. A correction that is not applied to the extra vehicles can mark one member and not another. A correction that is applied, and that changes the flight designator, clears each extra vehicle's landing and moves that member's end on its own.
