# Ride states

Status: accepted; partially superseded by ADR-0008

ADR-0008 supersedes "Only the Driver may set `accepted`." ADR-0010 adds which edits move an accepted Ride back to `assigned`. The vehicle-only rule in this decision still stands. The rest of this decision stands, including the edge that ADR-0006 later closed.

## Context

v1 needs one shared list of Ride states so the Dispatcher board and the Driver's phone agree on what a Ride is. The Charter already uses unassigned, accepted, done, and no-show. A Ride that will not run still has to stay on record, because the audit log must show that it was called off. Deleting it would erase that. Whether a Driver must accept a Ride, how long a No-show waits, and who is charged are still with Nikša and are not decided here.

## Decision

We will give each Transfer exactly one Ride in v1, created with the Transfer in `unassigned`. A Ride is never deleted, never revived, and never replaced by a second Ride on the same Transfer. A trip that is still on after a cancel is a new Transfer.

The states are `unassigned`, `assigned`, `accepted`, `done`, `no-show`, and `cancelled`. The last three are terminal.

- `unassigned` has no Driver and no Vehicle.
- `assigned` has both a Driver and a Vehicle, and that Driver has not accepted.
- `accepted` means that Driver has accepted. Changing only the Vehicle, with the same Driver, leaves it `accepted`. The same vehicle-only change while `assigned` leaves it `assigned`.
- The Dispatcher and the admin assign, clear, reassign, change the Vehicle, and cancel. The Driver does none of those.
- From `accepted`, sending the Ride back to `unassigned` clears the Driver and the Vehicle. Reassigning it to another Driver sets that Driver and a Vehicle and moves the Ride to `assigned`.
- Only the Driver may set `accepted`.
- The Driver may set `done` or `no-show` from `accepted`. The Dispatcher and the admin may do that too. The audit log records which person did it.
- The Dispatcher and the admin may set `cancelled` from `unassigned`, `assigned`, or `accepted`.
- A Ride that is `done`, `no-show`, or `cancelled` has no further transition.
- Whether `done` or `no-show` may also be reached from `assigned`, without `accepted`, waits on Nikša. This decision does not invent that edge.
- A Driver's upcoming list is the non-terminal Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs. How the Driver is told is the alerts work, not this decision.

## Consequences

The board can show unassigned, assigned-but-not-accepted, and terminal Rides without a second meaning for the same word. An office user can close or call off a Ride when the Driver does not, and the audit log shows that the office did it. A mistaken cancel cannot be undone on the same Transfer. The Driver's phone must drop a Ride the moment it is taken, even if the alert itself is built later. The missing `assigned` → `done` / `no-show` edge is the only state question still open.
