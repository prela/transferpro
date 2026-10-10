# Operational-day start

Status: accepted

Damir accepted this on 10 October 2026.

Supersedes, in ADR-0021, the sentence that the cutoff is 05:00. Supersedes, in ADR-0015, the closed list of three settings actions, by adding one. The rest of both decisions stands.

## Context

ADR-0021 fixed the operational day at local 05:00 so the board and the office home would agree. Klečak starts at 05:00. Another Tenant may draw that line at a different hour. Issue #80 left the clock open. The late-night block that lists one pickup on two days stays out of this decision.

Any hour from 0 to 23 was the wide alternative. A short list of 4, 5, and 6 was the narrow one. An afternoon hour would place a daytime pickup on the previous operational day. A three-value list cannot express local midnight, which makes the operational day the same as the calendar date.

## Decision

We will store an operational-day start on the Tenant: a whole hour from 0 through 8 inclusive. A new Tenant starts at 05:00, and a Tenant that already exists starts at 05:00 too. The operational day runs from that hour inclusive to the same hour the next day exclusive, in the Tenant time zone. A pickup at the start hour belongs to the new operational day. A pickup before it belongs to the previous one.

The board and the office home both use this hour. The roster and expiring documents keep the calendar date. The day is derived when those screens are read, so a saved hour applies to Rides already recorded. The pickup instant does not change, and neither does the window in which a pickup may be entered.

An admin changes the hour, as with the waits and the time zone. A dispatcher can see it and cannot change it. A real change appends `settings.operational_day_start_changed` with `{ from, to }` set to the previous hour and the next hour, and names no member. A patch that leaves the hour unchanged appends nothing for it.

Hours 2 and 3 fall inside the Europe/Zagreb daylight-saving shift. A skipped hour is read one hour later, and a repeated hour is read at the standard-time offset. That is the same rule that turns a pickup's clock reading into an instant.

## Consequences

Klečak stays on 05:00 until an admin changes the hour. Hour 0 makes the operational day the calendar date. A 23-hour or 25-hour local night breaks at the Tenant's start hour. When that hour is 2, the spring-forward morning starts one hour later. Adding the column does not move the board, because every existing Tenant starts at 05:00.
