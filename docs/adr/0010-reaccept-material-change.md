# Re-acceptance after the pickup, the places, or the flight change

Status: accepted

## Context

An accepted Ride means that Driver agreed to a pickup time, to where it starts and ends, and to the flight number. ADR-0005 keeps the Ride `accepted` when only the Vehicle changes. Leaving it `accepted` after the time or the place changes would send the Driver to the meeting they no longer have. Clearing the Driver would drop a Ride that still has someone to drive it. Alerting them without clearing acceptance would leave a yes standing for details they have not seen.

## Decision

We will move an `accepted` Ride back to `assigned` when the pickup time, where it starts, where it ends, or the flight number changes. The Driver and the Vehicle stay. The copied must-accept flag stays. The Driver is alerted. The same change on a Ride that is only `assigned` leaves it `assigned`. Changing the Client, the passenger count, the guest name, the price, the payment, the airport mark, the landing time, or only the Vehicle does not leave `accepted`.

## Consequences

The Driver must accept again, or the office must record acceptance again, before that Ride can be finished. Until then the board warns that it still requires acceptance, and the Driver may decline it, because decline is allowed from `assigned`. A correction to the guest's name does not throw away a phone confirmation. The alert tells the Driver that the previous acceptance no longer stands.
