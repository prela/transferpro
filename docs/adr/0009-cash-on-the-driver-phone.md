# Driver sees the price when payment is cash

Status: accepted

## Context

The Driver collects cash from the guest. The price, and whether the Ride is cash or card, are recorded on the Transfer for the office. Showing every price on the phone exposes card fares the Driver does not collect. Hiding every price leaves a cash Ride with no amount to ask for.

## Decision

We will show the Driver the price and the payment method when payment is cash. When payment is card, the Driver sees neither the price nor the payment method. The Dispatcher and the admin always see both. No card number is stored.

## Consequences

A cash pickup can be collected without a call to the office. A card fare stays off the phone. Changing payment from card to cash reveals the price on that Driver's Ride; changing it to card hides it. That change does not itself move the Ride between `assigned` and `accepted`.
