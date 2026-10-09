# 115 Office home

Grill decisions for the office home. The read shape is still open.

## Decisions

- In progress is derived (ADR-0022). No new Ride state.
- The Ride day is the operational day, 05:00 to the next 05:00 in the Tenant time zone, shared with the board (ADR-0021). The roster and expiring documents stay on the calendar date.
- Waiting on acceptance is assigned with the Ride's must-accept copy on, at any pickup time, until accepted, declined, or cancelled.
- The unassigned alarm is the four hours before pickup on an unfinished unassigned Ride (ADR-0023). It does not change ADR-0006.
- The unassigned list is every unfinished unassigned Ride, soonest pickup first. The alarm is a mark on that list.
- Statistics are counts for one operational day: Rides, unassigned, waiting on acceptance, in progress, done, no-show, cancelled. Admin and Dispatcher see them. A Driver does not. A day count can be smaller than the matching list.
- The office sees every price and payment method on this screen. The Driver still sees price and payment method only for cash (ADR-0009, ADR-0020).
- A ride row may show the flight number as text. A live flight link belongs on the ride detail. This issue does not add a flight tracker.
- Home loads on open and on a manual refresh. It does not poll.
- Expiring documents stay as they are, including who sees which row. Notifications stay mail only. Maps stay on Locations. Locale and theme stay on Profile.
