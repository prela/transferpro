# Operational day

Status: accepted; partially superseded by ADR-0025

Damir accepted this on 10 October 2026.

ADR-0025 supersedes "The cutoff is 05:00." The day is still half-open in the Tenant time zone. The board and the office home still share that bound. The roster and expiring documents still keep the calendar date. The recorded pickup instant still does not change.

## Context

The board lists a Ride on the calendar day of its pickup in the Tenant time zone, from local midnight to the next local midnight. A pickup at 00:30 is that calendar date, and the team treats it as a late transfer of the previous date. Issue #80 proposed a cutoff and left the clock time open. The office home must use the same day bounds as the board, or the list and the counts will disagree. The roster date and the expiring-document window are calendar dates already, and they are a different day.

## Decision

We will give a Ride an operational day: from 05:00 inclusive to the next 05:00 exclusive, in the Tenant time zone. A pickup at 05:00 belongs to the new operational day. A pickup before 05:00 belongs to the previous one. The board and the office home both use this bound. The roster and expiring documents keep the calendar date. The cutoff is 05:00.

## Consequences

A 00:30 pickup is listed and counted with the previous operational day. The board's midnight bound changes when this is built. A 23-hour or 25-hour local night still breaks at local 05:00, which in Europe/Zagreb is outside the daylight-saving shift. The recorded pickup instant does not change, and neither does the window in which a pickup may be entered.
