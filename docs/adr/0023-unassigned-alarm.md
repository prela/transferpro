# Unassigned alarm

Status: accepted

Damir accepted this on 10 October 2026. This does not supersede ADR-0006.

## Context

ADR-0006 says v1 has no acceptance deadline. Issue #29 warns on every unfinished unassigned Ride, and on every assigned Ride that is waiting on acceptance, before and after pickup, with no hour limit. Damir keeps a further mark: a silent alarm four hours before pickup, and only for an unfinished unassigned Ride. Silence means the alarm sends no mail. The acceptance rule and this alarm were easy to collapse into one deadline. They are different.

## Decision

We will mark an unfinished unassigned Ride during the four hours before its pickup. The office home shows that mark on the unassigned list. The list itself is every unfinished unassigned Ride, soonest pickup first, with or without the mark. Waiting on acceptance has no hour limit and does not take this alarm. ADR-0006 stands: there is still no acceptance deadline. The alarm sends no mail.

## Consequences

A Ride that is unassigned with the pickup five hours away is on the list without the mark. Inside four hours it gains the mark. After pickup it stays on the list under the #29 warning, and the four-hour mark does not apply. Nothing in this decision makes a Driver accept by a clock time, and nothing sends the alarm by email.
