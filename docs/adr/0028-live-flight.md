# Live flight: landing time and expected arrival

Status: accepted

Damir accepted this on 11 October 2026.

Supersedes, in ADR-0007, the sentence that there is no flight feed. The rest of that decision stands. This does not supersede ADR-0010, ADR-0026, or ADR-0027.

## Context

ADR-0007 starts the airport no-show wait from the recorded landing time, and from the scheduled pickup when none is recorded. It also says there is no flight feed. The Charter lists a flight-tracking API as a v1 non-goal. Nikša wants the stored flight checked against a live status, the actual landing written, the no-show clock started from that landing, and the Driver told when the arrival moves early or late. A person can still record or clear the landing time. ADR-0010 returns an accepted Ride to assigned when the flight number changes, and does not do that when only the landing time changes. ADR-0027 marks an in-progress Ride from the scheduled pickup plus 60 minutes, and a recorded landing does not move that instant. ADR-0026 is the Driver notification port. Its v1 adapter is mail. A landing-time change sends nothing.

One stored instant was the alternative. The feed would rewrite the landing time from an estimate to the actual time, and the no-show clock would read that estimate before the aircraft had landed. The other alternatives were to judge early and late against the pickup time, to let the feed replace a time a person had typed, to keep one airport code on the Tenant, and to return the Ride to assigned when the arrival moved.

## Decision

We will keep two facts. The landing time stays empty until the aircraft has landed, and then it is the actual time. The expected arrival is the live status's current estimate of when that aircraft will arrive. The no-show clock never reads the expected arrival. ADR-0027 is unchanged: the unclosed mark stays on the scheduled pickup.

We will track only an unfinished airport pickup whose flight number is one flight designator. The arrival airport must match the pickup Location's IATA code. An IATA code is optional, and only a Location of kind airport may carry one. When that code is missing, the Ride stays on the typed landing time and the feed writes nothing.

The flight instance is the arrival closest to the pickup instant among the pickup's calendar date and the day on either side, in the Tenant's time zone, and only when that arrival is within 6 hours of the pickup. Otherwise we write nothing. We store the current expected arrival whenever the feed reports one. We ask the feed every 15 minutes from 12 hours before the pickup until a landing time is stored, the Ride is done, no-show, or cancelled, or the flight will not arrive at this airport. The feed vendor is a later ticket. This decision names no supplier.

The feed writes a landing time only when it is empty and the aircraft has landed. A time a person recorded stays until they clear it. After a clear, the feed may write the actual time. A landing time cannot be an instant that is still in the future. A person may still record or clear it under ADR-0007. A feed write of the landing time is not a notice.

A movement is a change of at least 15 minutes against the last expected arrival the Driver was told, or against the first expected arrival stored when the Driver has been told nothing. We notify the assigned Driver through the ADR-0026 port only. We do not add a channel. When the Ride has no Driver, we store the movement and notify nobody. When the feed says the flight is cancelled, or that it will arrive at a different airport, we clear the expected arrival, we do not write a landing time, and we notify the assigned Driver through that same port that the flight will not arrive here. The no-show clock then stays on the scheduled pickup unless someone records a landing time.

Changing the flight number to a different designator clears the expected arrival and the landing time in that same change. ADR-0010 still returns an accepted Ride to assigned for that change. A spacing-only edit is the same designator and clears nothing. A change in the expected arrival does not clear acceptance, and nor does a landing-time change.

## Consequences

An estimate cannot start the airport wait. A typed landing time blocks the feed until it is cleared, including when the typed time is wrong. A future instant cannot be stored as a landing. A diversion does not become a landing at the pickup.

A flight-number change throws away a landing time a person typed for the previous flight. They record it again for the new flight if they still have one. The Driver is not asked to accept again merely because the arrival moved, so done and no-show stay available on an accepted Ride while the aircraft is late.

The unclosed mark can show while the flight is still in the air, because it does not follow the expected arrival. A Location with no IATA code is never tracked, so the pilot stays on a typed landing until that airport Location has a code. The Charter non-goal is not edited here.

The notice is a later use of the ADR-0026 port. ADR-0026's rule stands for everything it already covers: a landing-time change still sends no work order. The 15-minute ask can notice a movement only at the next ask. No vendor is chosen, so this decision does not add an adapter.
