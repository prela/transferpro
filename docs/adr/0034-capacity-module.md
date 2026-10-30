# Capacity as a module

Status: accepted; partially superseded by ADR-0058 and ADR-0059

Damir accepted this on 19 October 2026, in the step 13 grill of #206. It partially supersedes one consequence of ADR-0029, named below, and extends the import-boundary allow-list of ADR-0036. ADR-0029 still decides the occupied window, the relocation gap, the 409 `ride_overlap`, and its confirmation. ADR-0046 stays the server version check. ADR-0048 decides how a Ride handed to a Partner fits the Ride states.

## Context

ADR-0036 gave `capacity` the decision whether a Driver, a Vehicle, or a Partner is free, and the unavailability windows. It reads who is taken through a port that the transfers infrastructure implements, and there is no occupation table. It left three things to this step: what a free Partner is, the locking, and the shape of the port. The owner decided on 14 October 2026 that an overlap warns and passes after confirmation, and that a hard block happens only when no Vehicle and no Partner is free.

The overlap rule lived in three places. The pure judge sat in `shared` and served the browser pre-check, the board warnings, and the occupation strip. The command check and the board's neighbour read sat in transfers. Two assignments that took the same Driver or the same Vehicle for two different Rides at the same instant could both pass without confirmation: the check locked only Rides that were already assigned or accepted, so each command saw the other Ride as unassigned.

The alternatives were seats as part of capacity; refusing to record a Transfer when nothing is free; one advisory lock per Driver and per Vehicle; `for update` on the Driver and Vehicle rows; serializable transactions with retries; an exclusion constraint, which needs an occupation table and cannot allow a confirmed overlap; a Partner limit per day; a reason or a kind on an unavailability window; and deleting a window by hand.

## Decision

### What capacity is

Capacity is about time only: whether a Driver, a Vehicle, or a Partner is taken or unavailable at a given time. It does not count seats. A Vehicle has no seat count in v1.

`capacity` owns the whole overlap rule: the occupied window and the judge, as its contract in `shared/capacity`; the command check; the board's overlap warning; and the occupation that the occupation strip shows. The ADR-0029 rule moves unchanged.

### Free

A Driver or a Vehicle is free for a window when it is not archived, no occupying Ride overlaps the window, and no unavailability window covers any part of it. A Partner is free when it is not archived and no unavailability window covers any part of the window. A Ride handed to a Partner does not occupy that Partner.

### Unavailability windows

The office, a Dispatcher or an Admin, records an unavailability window for a Driver, a Vehicle, or a Partner. It runs from one instant to a later one and is half-open, like the occupied window. The form offers whole days in the Tenant time zone as a shortcut. A window carries no reason and no kind. The office records it on the Driver, Vehicle, or Partner detail screen; the roster week grid shows it without editing.

The windows are stored in one table with three composite foreign keys, to the Driver, the Vehicle, and the Partner, each paired with the Tenant, and a check that exactly one is set. A window is removed by marking it removed; a removed window no longer counts. A daily job deletes windows that ended more than 90 days ago, removed or not. This record is the ADR that allows that `DELETE` grant. The grant is limited to that table and that job. An audit entry for a window holds the window id, the Driver, Vehicle, or Partner id, and the field names. It never holds the instants.

Assigning an unavailable Driver or Vehicle, or handing a Ride to an unavailable Partner, returns 409 `ride_unavailable` and writes nothing. The same command with `confirm: true` passes, as for an overlap. One confirmation covers both an overlap and an unavailability. A window that covers Rides already assigned, accepted, or handed off still saves; the response lists those Rides, and each shows an unavailability warning, derived on read (ADR-0032).

### Fully booked

A window is fully booked when no free Driver with a free Vehicle exists and no free Partner exists. Any active Driver may pair with any active Vehicle; the roster is not required. The Ride being changed does not occupy anything, so a chosen Driver and Vehicle that are both free are never fully booked.

Assign, a Vehicle change, a reassignment, a handoff, and a change of Partner are refused with 409 `fully_booked` when the window is fully booked. `confirm` does not pass it. Recording or correcting a Transfer, a duplicate and a return journey included, still saves and returns a fully booked warning. A Transfer correction is judged for `ride_overlap` and `ride_unavailable` as in ADR-0029 and returns a fully booked warning; it is never refused as fully booked. The board shows the same warning on an unfinished unassigned Ride, derived on read.

The refusals come in this order: the existing ones (role, input, `stale_save`, state, archived), then `fully_booked`, then `ride_overlap` or `ride_unavailable`. Every 409 writes nothing, sends no work order, and appends no audit entry. The tight-gap warning is unchanged.

### Locking

Every capacity write takes one transaction-level advisory lock for its Tenant: assign, a Vehicle change, a reassignment, a Transfer correction that ADR-0029 judges, a handoff, a change of Partner, and adding, changing, or removing an unavailability window. The command takes it after the Transfer and Ride row lock and the refusals that need no other row, and before it reads a Driver, a Vehicle, a Partner, or another Ride. It waits with no timeout. Occupation is then read without row locks. Two capacity writes of one Tenant run one after the other, and the second sees what the first committed. Two Tenants never wait on each other. Clear, taking a handoff back, closing a Ride, a landing time, and a change of transfer duration take no lock; ADR-0029 judges none of them.

### The port

`capacity` defines the occupation port, and the transfers infrastructure implements it. It is asked with Driver, Vehicle, and Partner ids, or for the whole Tenant, a time range, and a Ride to leave out. It answers with the Rides that are assigned, accepted, or handed off: the Ride id, the Driver id, the Vehicle id, the Partner id, the pickup, and the landing. `capacity` computes each window from the transfer duration and the relocation gap, read from `tenancy`. It finds active Drivers, Vehicles, and Partners through the `index.ts` of `drivers`, `vehicles`, and `partners`.

Transfers calls one `capacity` application service and passes its port adapter in. The service returns a verdict: the overlaps, the tight gaps, the unavailable resources, and whether the window is fully booked. `capacity` exports the error classes, and transfers decides which one to throw.

The allow-list grows to this: `capacity` may import `tenancy`, `drivers`, `vehicles`, and `partners`. Only transfers imports `capacity`. `capacity` does not import transfers.

### Order of work

The Tenant lock lands first, in today's transfers code, with a concurrency test. Beside it, a prefactor makes the unclosed-mark threshold one shared value, with no change in behaviour. The extraction of the module follows with the same behaviour, then unavailability windows for Drivers and Vehicles, with the retention job. The Partner module waits on the #206 step 18 grill, which settles the Partner record. The handoff (ADR-0048) follows the Driver and Vehicle windows, the Partner module, and the threshold prefactor. Unavailability windows for Partners follow the handoff, together with the confirmation for handing a Ride to an unavailable Partner. The hard block with the fully booked warning comes last.

## Consequences

Two Dispatchers can no longer put one Driver or one Vehicle on two clashing Rides by saving at the same instant, and the fully booked judgement cannot be passed by a save that commits beside it. A Tenant's capacity writes queue behind each other. At pilot volume the wait is short, but one slow capacity write delays the next.

A Tenant with an active Partner that has no unavailability window is never fully booked. The hard block bites only when every Partner is archived or unavailable, or the Tenant has none.

A Transfer for more guests than a Vehicle seats is not caught. A window says that someone is away, not why, so no health data is stored, and the audit log shows that a window changed, not when a Driver was away. The browser can still pre-judge an overlap, but only the server knows the windows and the fleet, so its answer is final.

A landing, or a new transfer duration, that moves the end of a window still surfaces only on the next judged command, as in ADR-0029.

### Superseded

ADR-0029's consequence "Two commands that overlap can still both pass if they commit together: the other Ride is locked `for share`, so the second waits and then sees the first." Two capacity writes of one Tenant now run one after the other under the Tenant lock, and the occupation read takes no row lock.
