# Office acceptance, confirmed by phone

Status: accepted

Supersedes, in ADR-0005, the rule that only the Driver may set `accepted`. Supersedes, in ADR-0006, the reading that a phone confirmation is never recorded. ADR-0006 still stands where it says Transferpro places no phone call and has no acceptance deadline.

## Context

Nikša confirms external Drivers by phone. ADR-0005 allowed only the Driver to set `accepted`, so a Driver who had already agreed stayed `assigned` until they opened the app. The office already makes that call. Building the call into the product was the alternative, and it was rejected. Leaving the "yes" unrecorded keeps the board warning that the Ride is not accepted, and blocks `done` and `no-show` while the Ride requires acceptance.

## Decision

We will let the Dispatcher and the admin record `accepted` from `assigned` when that Ride requires acceptance. The audit log records it as an office action, confirmed by phone, and names the person who recorded it. The Driver may still accept the Ride themselves. The same state results either way. Recording acceptance is refused when the Ride does not require acceptance, and from every state other than `assigned`. Transferpro does not place the call.

## Consequences

A collaborator who said yes by phone can be marked `done` or `no-show` without opening the app, and the audit log shows that the office accepted for them. The board stops warning that this Ride needs acceptance. Someone can record a yes the Driver did not give; the audit entry is how that is found. The Driver's own accept and the office action are the same state, distinguished only by who the audit log names.
