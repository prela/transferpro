# Landing alarm

Status: accepted

Damir locked this on 11 October 2026, on issue #183. This does not supersede ADR-0027 or ADR-0029.

## Context

ADR-0027 marks an in-progress Ride 60 minutes after its scheduled pickup. That instant does not move when a landing is stored. ADR-0029 stores a Tenant transfer duration, default 60 minutes, and says this alarm reads that same column. The no-show wait, the unassigned alarm, and the unclosed mark answer different questions. A Ride that has landed can still be unfinished long after the transfer should have ended.

## Decision

We will show a landing alarm on an in-progress Ride that has a stored landing time, once 60 minutes have passed after the expected end. The expected end is that landing plus the Tenant transfer duration. The 60 minutes after the end are fixed. They are not a setting, they are not stored on the Ride, and they are not written to the audit. A Ride with no landing time does not take this alarm. It keeps the unclosed mark. Storing a landing does not move the unclosed mark.

The alarm is display only. It does not allow or refuse done, no-show, cancel, or assignment. It sends nothing.

The office home shows it on the in-progress list, including earlier days, to an admin or a dispatcher. The day board shows it on an in-progress Ride whose pickup falls on the operational day being viewed. The lists stay as they are. There is no extra list and no extra count. The flag is derived when the page is read.

## Consequences

A Ride with a landing can carry the unclosed mark while the landing alarm is still off, because the unclosed mark stays at pickup plus 60 minutes. The landing alarm turns on at landing plus the transfer duration plus 60 minutes, and that instant is included. Changing the transfer duration moves the landing alarm and does not move the unclosed mark. Clearing the landing drops the landing alarm. A Ride that is not in progress does not show it. The office home and the day board do not poll, so a page left open does not gain the alarm until the next read.
