# Accept by phone names the Driver the office called

Status: accepted

The owner accepted this on 15 November 2026, in the decisions on #574. It amends ADR-0008: the office body is no longer empty. It partially supersedes one sentence of ADR-0062, named below. ADR-0006 and ADR-0046 stand. The Driver's own accept is unchanged.

## Context

ADR-0008 lets a Dispatcher or an admin record `accepted` after confirming with the Driver by phone. The body was empty. The Driver id written to the audit entry came from the locked Ride, so a colleague could reassign the Ride between the call and the confirmation and the office would record acceptance for a Driver nobody called. The board would then stop warning that the Ride needs acceptance.

ADR-0046 lists accept by phone among the actions that neither take nor change the version. A reassignment does change the version. Requiring that version would also refuse an acceptance after an unrelated office save on the same Transfer, such as a note. ADR-0062 recorded the gap and left it.

## Decision

The dialog sends the id of the Driver it showed. The route refuses when the Ride has a Driver and it is not that one. Nothing is written, no audit entry is appended, and no mail is sent. The version stays untouched, as ADR-0046 says.

The body is `{ driverId }`. Zod requires that id before a session opens. A missing or malformed id is 400. Any other key is still 400. There is no version in the body.

The refusals come in this order, and a test locks it: a body that fails is 400 before a session is opened; no session is 401; a Driver is 403; another Tenant's Ride, or no such Ride, is 404; a Ride whose Driver is not the one named is 409 `ride_driver_changed`; a Ride that is not `assigned`, whose copied flag is off, or that has no Driver is 409 `ride_not_acceptable`. The Driver check is first, so a reassignment is not reported as a Ride that cannot be accepted. A Ride with no Driver stays `ride_not_acceptable`.

A Ride reassigned from Driver A to Driver B and back to A, while the dialog still shows A, is accepted for A. The check is who the Ride has now, not whether a reassignment happened in between.

The message is "Vozač ove vožnje je u međuvremenu promijenjen." / "The Driver of this ride has changed in the meantime." The dialog shows it and refreshes the Ride. The Driver's own accept route, its empty body, and its refusals are unchanged.

## Consequences

The office cannot record a phone acceptance for a Driver it did not call, and the Dispatcher is told to call the new one. An unrelated save on the Transfer does not block the acceptance. A reassignment back to the Driver the dialog showed is accepted, which is the same as if the reassignment had not happened.

Someone can still record a yes the Driver did not give. The audit entry remains how that is found.

### Superseded

In ADR-0062: "Accepting by phone still takes no version and no Driver id, so after a reassignment the office could record acceptance for a Driver it did not call. This record does not change that." Accepting by phone still takes no version. It now takes the Driver id the dialog showed, and a different Driver is refused.
