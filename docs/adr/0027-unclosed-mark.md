# Unclosed mark

Status: accepted

Damir accepted this on 11 October 2026. This does not supersede ADR-0007 or ADR-0023.

## Context

Issue #163 proposed a warning when a Ride stays unfinished after pickup: a Tenant setting, an airport clock that starts from the recorded landing, and the scheduled job in #30. ADR-0007 already starts the no-show wait from the recorded landing at an airport, and from the scheduled pickup when no landing is recorded. Those waits are Tenant settings, 90 minutes and 25. ADR-0022 treats in progress as a derived situation, not a Ride state. ADR-0023 marks an unfinished unassigned Ride during the four hours before pickup and sends no mail. Issue #29 warns on every unfinished unassigned Ride and every Ride waiting on acceptance, with no hour limit. The no-show wait, the unassigned alarm, and those standing warnings were easy to reuse for a Ride nobody has closed. They answer different questions.

## Decision

We will mark an in-progress Ride once 60 minutes have passed since its scheduled pickup. The 60 minutes are fixed for every Tenant. They are not a setting, they are not stored on the Ride, and they are not written to the audit. A recorded landing does not move that instant. A Ride that becomes in progress after the pickup still uses the scheduled pickup, so a late assignment is marked at pickup+60.

The mark is display only. It does not allow or refuse done, no-show, cancel, or assignment. It sends nothing.

Issue #163 shows the mark on the office home in-progress list, including earlier days, to an admin or a dispatcher. The list stays every in-progress Ride. The mark is a flag on the row. There is no fourth list and no extra count. The flag is derived when that page is read. The #30 job does not produce it.

The day board is not part of #163. When #29 builds that board, it uses this same mark for an in-progress Ride whose pickup falls on the operational day being viewed.

ADR-0007 stays the no-show rule. ADR-0006 stays: there is still no acceptance deadline. ADR-0023 stays the four-hour unassigned alarm.

## Consequences

For the first 60 minutes the Ride is on the in-progress list with the mark off. At the instant of pickup+60 the mark is on. An unassigned Ride and a Ride waiting on acceptance do not take it. Changing the scheduled pickup moves the instant. Changing the airport mark or the landing time does not. A change that returns an accepted Ride to waiting on acceptance drops the mark, because the Ride is no longer in progress.

The office home does not poll, so a page left open does not gain the mark until the next read. #163 waits on none of #23, #27, #28, #29, or #30. A later settings reorg may put these 60 minutes, the four-hour unassigned alarm, and the no-show waits in one place. This decision opens no issue for that reorg.
