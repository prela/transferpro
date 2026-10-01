# Driver acceptance

Status: accepted; partially superseded by ADR-0008

ADR-0008 supersedes the assumption, in the context below, that only the Driver may set `accepted`. This decision still stands where it says Transferpro does not place the phone call and has no acceptance deadline. The office records the result of that call.

Settles the edge ADR-0005 left open: whether `done` and `no-show` require `accepted`.

## Context

Nikša said assigning a Ride is enough, and that acceptance can be turned on for a Driver, especially an external collaborator. He also said a Driver may refuse, and that if someone who must accept does not, the office calls them. He gave no number of hours. ADR-0005 already lets only the Driver set `accepted`, and lets the office take a Ride back from `accepted`.

Partner stays a subcontractor company. The person who drives is a Driver.

## Decision

We will put a **must accept** setting on the Driver. It defaults to off. The first Tenant turns it on for the collaborators who must accept. There is no separate role for them.

When a Ride is assigned, that Driver's setting is copied onto the Ride. Changing the Driver's setting later does not rewrite Rides already assigned.

- If the Ride does not require acceptance, the Driver may mark `done` or `no-show` from `assigned`. `accepted` is not used.
- If the Ride requires acceptance, `done` and `no-show` are reachable only from `accepted`, including when the Dispatcher or the admin marks them.
- Any Driver may decline from `assigned` only. The Ride returns to `unassigned`: the Driver and the Vehicle are cleared, and the Ride leaves that Driver's upcoming list immediately. The Dispatcher is to be alerted. How the alert is delivered is the alerts work.
- From `accepted`, the Driver may not decline. The office takes the Ride back, as ADR-0005 already allows.
- v1 has no acceptance deadline and no phone call in the product. The Dispatcher sees the assigned Rides that still require acceptance. The phone call Nikša makes today stays outside Transferpro.

## Consequences

Own drivers are not forced through `accepted`. A collaborator who must accept cannot mark the Ride finished until they do. A refusal returns the Ride to the board with no Driver and no Vehicle, and the old Driver's phone drops it at once. There is no timer that escalates an unaccepted Ride. The decline alert is a rule now and a job later.
