# Invoice to agency is a recorded payment

Status: proposed

## Context

ADR-0009 shows the Driver the price and the payment method when payment is cash, and hides both when payment is card. The office now also records a third choice, invoice to agency: the Client will be invoiced, and the Driver does not collect. Invoicing itself is not v1. The charter still names cash and card; this record does not change the charter.

The alternative was to store invoice to agency as card. That would hide the fare on the phone, and it would also lie about how the Ride is paid.

## Decision

We will store payment as `cash`, `card`, or `invoice_to_agency`. `invoice_to_agency` is a recorded choice. We will not send an invoice in v1.

When the Driver's phone is built, it will show the price and the payment method only when payment is cash. Card and invoice to agency hide both, the way ADR-0009 already hides a card fare. The Dispatcher and the admin always see both. This slice records the choice on the Transfer and does not build that phone.

## Consequences

The office can tell a cash Ride from a card Ride from a Ride the agency will be invoiced for. The phone rule is specified before the phone exists, so a later screen does not invent a fourth behaviour. ADR-0009 stays as written for cash and card. The charter text still says cash and card until the owner updates it.
