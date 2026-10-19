# A Ride handed off to a Partner

Status: accepted

Damir accepted this on 19 October 2026, in the step 13 grill of #206. It partially supersedes ADR-0005; the sentences are named below. It extends the unclosed mark of ADR-0027, the version of ADR-0046, and the office No-show of ADR-0007 to the new state, and changes none of them for a Ride that has a Driver. ADR-0034 decides when a Partner is free.

## Context

ADR-0033 brings a recorded handoff to a Partner into v1, with no Partner login. ADR-0036 keeps the record of a handoff on the transfers side, holding the Partner's id, and left to step 13 how a handoff fits the Ride states. ADR-0005 has six states, and `assigned` has both a Driver and a Vehicle. Every rule built on assigned (must-accept, work orders, occupation, in progress) assumes a Driver.

The alternatives were a handoff as a kind of `assigned` with a Partner in place of the Driver; a fact on a Ride that stays `unassigned`, which keeps the unassigned alarms firing; a separate handoff table; and a work order mailed to the Partner.

## Decision

We will add the state `handed_off` ("Predano podizvođaču"). It is not terminal. A handed-off Ride has a Partner and no Driver and no Vehicle. The Ride stores the Partner's id, and the database holds that `handed_off` means a Partner is set and no Driver or Vehicle is.

The office, a Dispatcher or an Admin, hands a Ride off from `unassigned`, `assigned`, or `accepted`. From `assigned` or `accepted` the handoff clears the Driver and the Vehicle, and that Driver gets the "no longer yours" work order, as on a clear. The office can change the Partner directly. It can take the Ride back to `unassigned`. It closes a handed-off Ride as `done`, `no-show`, or `cancelled` at any time, with no airport or elsewhere wait. The Driver's phone never shows a handed-off Ride.

A handoff and a change of Partner are capacity writes (ADR-0034): an unavailable Partner is 409 `ride_unavailable` and passes with `confirm: true`, and a fully booked window is 409 `fully_booked` with no confirmation. Taking it back and closing it are not judged. The Transfer of a handed-off Ride can be corrected; capacity does not judge that correction, and no work order is sent, because there is no Driver.

A handoff, taking it back, and a change of Partner are office data saves and change the ADR-0046 version. Closing it does not, as with the other office state actions.

No mail goes to a Partner in v1. The office tells the Partner itself.

The audit entry of a handoff holds the Ride id, the Partner id, the Driver id and the Vehicle id it cleared when there were any, and the field names. A change of Partner holds the Ride id, the new Partner id, and the field names. Taking it back holds the Ride id, the Partner id, and the field names. Closing a handed-off Ride uses the existing done, office No-show, and cancelled entries, with the Partner id where they hold the Driver id. No entry holds a name or a contact.

A handed-off Ride is not unassigned, so it takes no unassigned alarm and is never unassigned past pickup. It is not in progress, because it has no Driver (ADR-0022). It takes the unclosed mark once the same minutes have passed since its scheduled pickup as for an in-progress Ride. Both read one shared value, 60 minutes today (ADR-0027). That value is still open with the reference operator, so it is not repeated for the handoff.

### Superseded

In ADR-0005:

1. "The states are `unassigned`, `assigned`, `accepted`, `done`, `no-show`, and `cancelled`. The last three are terminal." There are seven states with `handed_off`, and the same three are terminal.
2. "The Dispatcher and the admin may set `cancelled` from `unassigned`, `assigned`, or `accepted`." They may also set it from `handed_off`.
3. "The Driver may set `done` or `no-show` from `accepted`. The Dispatcher and the admin may do that too." The Dispatcher and the admin may also set either from `handed_off`; the Driver may not.

The rest of ADR-0005 stands.

## Consequences

The office can hand a Ride to a subcontractor without inventing a Driver, and the board stops calling it unassigned. A mistaken handoff can be taken back, unlike a cancel.

Every list, count, and filter that reads the Ride state learns a seventh state, and the office home's day balance needs a count for it so the balance still adds up. A handed-off Ride that nobody closes takes the unclosed mark, so it is not forgotten. The Partner learns of the Ride only from the office.
