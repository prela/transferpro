# A Transfer whose Price is 0 is never invoiced

Status: accepted

Damir accepted this on 22 October 2026, in the step 2 re-grill of #206 (Q7). It partially supersedes ADR-0051; the sentences are named below. The rest of ADR-0051 stands. A group carried in several Vehicles, Q6 of that grill, is still open and gets its own record.

## Context

ADR-0051 lets the office invoice a Transfer when its payment is `invoice_to_agency` and its Ride is done. The invoice has one line, and its total equals the Transfer's Price. A Price may be 0. Under ADR-0051 such a Transfer could be invoiced for 0 EUR: an invoice that asks for nothing, yet takes a number in the current tool's series and a share of its monthly allowance of API invoices, and, when domestic, must still be sent from the tool and fiscalized.

A Price of 0 arises for a Transfer given free of charge. One of the options for a group in several Vehicles also leaves every Transfer but one at 0.

The alternatives were to invoice a Price of 0 like any other, and to refuse to record a Price of 0.

## Decision

We will never invoice a Transfer whose Price is 0. It is refused like any other Transfer that may not be invoiced, and the refusal writes and sends nothing. It is not listed under "Za fakturiranje". A Price of 0 can still be recorded and corrected; correcting it above 0 before an invoice is issued makes the Transfer invoiceable.

### Superseded

ADR-0051: "A Transfer may be invoiced when its payment is `invoice_to_agency` and its Ride is done, including a handed-off Ride the office closed as done." A Transfer may be invoiced when its payment is `invoice_to_agency`, its Ride is done, including a handed-off Ride the office closed as done, and its Price is above 0.

ADR-0051: "Transfers has a quick filter "Za fakturiranje" for done Rides with `invoice_to_agency` and no invoice." The filter lists done Rides with `invoice_to_agency`, a Price above 0, and no invoice.

## Consequences

A free Transfer never uses a number or the allowance of the current tool, and no 0 EUR invoice needs a storno. A Price left at 0 by mistake is not invoiced until the office corrects it, and nothing warns about it. The #435 spec carries the rule before #439 starts.
