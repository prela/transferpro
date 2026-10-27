# Ride occupation

Status: accepted; partially superseded by ADR-0034 and ADR-0058

Damir locked this on 11 October 2026, with NEO, on issue #184. On 13 October 2026 it was extended to a Transfer correction that moves the occupied window. ADR-0005 still names who may assign, change the Vehicle, reassign, and clear. This decision adds when those commands refuse a time clash. It does not add a Ride state. ADR-0022 stands: in progress is derived.

## Context

A Driver or a Vehicle can be put on two Rides whose times collide. A true collision should stop the command until the dispatcher confirms it. A short gap between Rides should warn and still save. A Ride stores a pickup and, sometimes, a landing. It does not store an end. The No-show waits are a wait at the pickup, not the time the Ride occupies.

Clearing a Ride frees the Driver and the Vehicle, so it has nothing to clash with. A Transfer correction (#26, #197) keeps the Driver and the Vehicle, but it can move the pickup, and a new flight designator clears a stored landing. Either can create the same clash, and the slideover makes pickup edits common.

## Decision

We will store two minute counts on the Tenant, each from 1 through 1440. A new Tenant, and one that already exists, starts at a transfer duration of 60 and a relocation gap of 15. An admin changes them the same way as the waits. A real change appends `settings.transfer_duration_changed` or `settings.relocation_gap_changed` with `{ from, to }` and names no member. #183 reads the same transfer-duration column. This decision does not add a second duration.

The occupied window opens at the pickup. It ends at the landing plus the transfer duration when a landing is stored, and otherwise at the pickup plus the transfer duration. A landing that finishes that sum before the pickup leaves an empty window.

Assigned and accepted Rides occupy that window, including a Ride that is already in progress. Done, no-show, cancelled, and unassigned do not. The Ride being changed is excluded.

Assign, a vehicle change, and a reassignment judge the Driver and the Vehicle they are about to write. A true overlap, a shared instant on either, returns 409 `ride_overlap` and writes nothing, so no work order is sent. The same command with `confirm: true` writes and sends the work order it already sends. A gap shorter than the relocation gap, and not an overlap, does not return 409 and does not use `confirm`. The saved action carries that warning. A gap equal to the relocation gap is neither. Clear does not judge.

A Transfer correction judges the Driver and the Vehicle already on the Ride, and only when the save moves the start or the end of its occupied window, compared before and after. A pickup change moves the start. A flight-number change that clears a stored landing can move the end. A place change alone moves neither. An unassigned Ride is not judged. An overlap the office confirmed earlier is judged again, as a vehicle change judges a Driver it keeps. The 409, `confirm`, and the gap warning work as they do for assign. Every other refusal comes first: role, input, a finished Ride, an archived Location. A save that changes nothing writes nothing and never returns 409. A 409 leaves an accepted Ride accepted and sends no work order. A confirmed save writes the correction and any return to assigned in one transaction, then sends the changed work order. Audit stays `transfer.corrected` and, when it applies, `ride.returned_to_assigned`. No entry records the confirmation, on this or any other command, and a 409 writes no entry. Recording or clearing a landing, and changing the transfer duration, are not judged.

## Consequences

Two commands that overlap can still both pass if they commit together: the other Ride is locked `for share`, so the second waits and then sees the first. A landing, or a new transfer duration, that moves the end can turn a legal gap into an overlap that surfaces only on the next assign, vehicle change, reassignment, or correction that moves the window. A correction that fixes only the guest, a count, or the price never surfaces it. Nudging the pickup of a Ride that already overlaps asks for confirmation again. The warning names the other Ride by id. It does not name the guest.
