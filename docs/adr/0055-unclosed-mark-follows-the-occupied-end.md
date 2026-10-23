# Unclosed mark follows the occupied end

Status: accepted

Accepted on 23 October 2026 in the unclosed-mark grill. Nikša asked for the mark 60 minutes after the planned end. This partially supersedes ADR-0027, ADR-0028, ADR-0030, and ADR-0048; the sentences are named below. It does not remove the landing alarm. ADR-0054 stands: each member of a group is its own Transfer and its own Ride.

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

This decision does not remove the landing alarm. On an in-progress Ride with a stored landing, the unclosed mark and the landing alarm turn on at the same instant.

### Superseded

In ADR-0027, "We will mark an in-progress Ride once 60 minutes have passed since its scheduled pickup." The sentences that the 60 minutes are fixed, not a setting, not stored, and not written to the audit, stand. "A recorded landing does not move that instant. A Ride that becomes in progress after the pickup still uses the scheduled pickup, so a late assignment is marked at pickup+60."

In ADR-0027's consequences, "For the first 60 minutes the Ride is on the in-progress list with the mark off. At the instant of pickup+60 the mark is on." And "Changing the scheduled pickup moves the instant. Changing the airport mark or the landing time does not." An unassigned Ride and a Ride waiting on acceptance still do not take it. A return to waiting on acceptance still drops it.

In ADR-0028, "ADR-0027 is unchanged: the unclosed mark stays on the scheduled pickup." The expected arrival still does not move the mark, and a Ride with no landing can still be marked while the flight is in the air.

In ADR-0030, "Storing a landing does not move the unclosed mark." In its consequences, "A Ride with a landing can carry the unclosed mark while the landing alarm is still off, because the unclosed mark stays at pickup plus 60 minutes." And "Changing the transfer duration moves the landing alarm and does not move the unclosed mark." The landing alarm's own instant stands.

In ADR-0048, "It takes the unclosed mark once the same minutes have passed since its scheduled pickup as for an in-progress Ride." A handed-off Ride still shares the one 60 minutes with an in-progress Ride.

## Consequences

A city Ride with the default transfer duration of 60 is marked at pickup plus 120 minutes. A landed Ride is marked at the landing plus the duration plus 60. A late landing can turn a mark off until the new instant, and clearing that landing can turn it on again. Changing the duration moves marks that are already showing.

On a landed in-progress Ride the office sees two urgent marks for one fact, until a later decision keeps or drops the landing alarm. Home files that Ride under the landing alarm, because that kind is placed first.

Each member of a group is judged from its own pickup and its own landing. A correction that is not applied to the extra vehicles can mark one member and not another. A correction that is applied, and that changes the flight designator, clears each extra vehicle's landing and moves that member's end on its own.
