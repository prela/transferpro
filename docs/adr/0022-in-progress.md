# In progress is not a Ride state

Status: accepted

Damir accepted this on 10 October 2026.

## Context

The office home needs to show Rides that are underway. ADR-0005 has six states, and in progress is not one of them. A new state would need a migration and someone to set it. Nothing on the Ride records that the Driver has started. The alternative was to add that state.

## Decision

We will treat in progress as a derived situation. A Ride is in progress when it has a Driver, it is not done, no-show, or cancelled, it is not waiting on acceptance, and its pickup is already in the past. A pickup on an earlier day stays in progress until the Ride is done, a no-show, or cancelled. We will not add a state.

## Consequences

No migration. A Ride that still requires acceptance and has not been accepted is waiting on acceptance, including after pickup, and is not in progress. An assigned Ride that does not require acceptance is in progress once the pickup is past. The office home can list every in-progress Ride, including earlier days, while a count for one operational day includes only the pickups on that operational day. Those two numbers can differ.
