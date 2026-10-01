# No-show

Status: accepted

## Context

Nikša waits 90 minutes at the airport and 25 minutes elsewhere. The Driver is who marks a No-show on the ground. Nobody is charged today. He did not say whether the airport wait starts at landing or at the scheduled pickup. A flight-tracking feed is a Charter non-goal. ADR-0005 already lets the Dispatcher and the admin mark a No-show, with an audit entry. Invoicing is a Charter non-goal.

## Decision

We will record a No-show and charge nothing for it in v1.

The Dispatcher marks the pickup as an airport on the Transfer. The wait lengths are Tenant settings. A new Tenant starts at 90 minutes for an airport and 25 minutes elsewhere.

- Elsewhere, the wait runs from the scheduled pickup.
- At an airport, the wait runs from the actual landing time when one is recorded, and from the scheduled pickup when it is not. Recording or clearing the landing time before the No-show changes which clock is used. The Dispatcher, the admin, and the Driver assigned to that Ride may record it. There is no flight feed.
- The Driver may mark a No-show only after the wait has elapsed, and only from the state ADR-0006 allows (`assigned` when acceptance is not required, otherwise `accepted`).
- The Dispatcher and the admin may mark a No-show before the wait has elapsed. The audit log records that they did. They may not skip the state: if the Ride requires acceptance, they too mark it from `accepted`.

## Consequences

A late flight does not become a No-show at the scheduled time once someone has typed the landing. Until they do, the airport wait falls back to the schedule, so a missing landing time does not trap the Ride. The office can close a No-show early, and the audit log distinguishes that from the Driver waiting it out. No fee is stored, so a later charging rule will not find a price already written on old No-shows.
