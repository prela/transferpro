# One office home read

Status: accepted

Damir accepted this on 10 October 2026.

## Context

The office home shows three Ride lists and seven operational-day counts. An Admin and a Dispatcher see all of them. A Driver sees none. Expiring documents already have their own read, and a Driver uses that read for their own licences. One read per list would let the counts and the lists come from different moments, so a Ride could appear in two lists across a single refresh. One combined read fails as a whole.

## Decision

We will return the three lists and the seven counts from one office read, taken at one moment. The lists are every unfinished unassigned Ride, every Ride waiting on acceptance, and every Ride in progress. The counts are for the current operational day. Expiring documents stay on their own read. Opening the office home loads both reads. A manual refresh loads both again. The page does not poll.

## Consequences

A refresh cannot place one Ride in two lists because the two responses straddle a change. If the office read fails, the lists and the counts fail together, and expiring documents can still appear. A Driver is not given this read. Splitting the lists into their own reads later would give up that single moment.
