# The Transfer is the order, and who owns the v1 modules

Status: accepted; partially superseded by ADR-0051

Damir accepted this on 14 October 2026. It extends ADR-0018 and supersedes none of its sentences. It does not reopen the decisions that #206 lists as locked.

## Context

#206 and the owner's scope note of 14 October 2026 speak of an order, call guests clients, and call agencies and hotels partners. They also name CRM, Capacity, pricing, and invoicing as modules. `GLOSSARY.md`, the Charter, and ADR-0033 say Transfer for the booking, Client for the agency, hotel, or individual who books, and Partner for a subcontractor company a Ride is handed to. The reference operator also calls agencies partners, so the first Tenant may speak that way. ADR-0018 keeps Clients, Locations, and Invoicing as standalone modules that Transfers depend on, never the other way round.

Phase E of #206 builds on this language. If it is wrong, that phase is reworked (#206, risk 6).

The alternatives were an Order above the Transfer; a return journey as a second Ride; Partner renamed to mean agency or hotel; a Partner as a kind of Client; one `crm` module for Clients and Partners; Capacity that stores its own occupation records; the price list inside transfers; a zone as a field of the Location; invoicing that reads transfers; and Client history read by the clients module.

## Decision

### Language

The Transfer is the order. There is no Order term. Where #206 and ADR-0033 say order, read Transfer. Step 29's "stored on the order" reads as kept by invoicing against the Transfer's reference.

An Order may come later, when a channel manager or a channel that sends several segments in one booking needs it. It is added above the Transfer and does not change the Transfer.

A return journey is its own Transfer, with its own pickup, places, price, payment, and invoice. Several Rides of one Transfer means the same journey split across several Vehicles; a Ride is never a leg. In v1 a Transfer still has exactly one Ride. The Charter's "Rides/legs" reads that way. An arrival and its return journey are tied only by the Client reference (ADR-0003).

A Client is the agency, hotel, or individual who books a Transfer, and an invoice for a Transfer goes to its Client. A Partner is a subcontractor company a Ride is handed to. A company in both roles is two records, a Client and a Partner, with no link between them. In the scope note, "partners (agencies, hotels)" reads as Clients and "clients (guests)" reads as guests. The Croatian UI says Naručitelj for a Client and Podizvođač for a Partner, and does not use the Croatian word partner. Step 8 of #206 confirms the final Croatian labels; it may change a label, not a term.

A guest is the person who travels, named on the Transfer by one name, the lead of the group. A guest is not a record and is not linked to an individual Client who is the same person. This record adds no guest contact.

### Modules

CRM is not a module. The Client card (contacts and notes) lives in `clients`, in child tables keyed by `client_id`, as ADR-0018 already allows.

`partners` is a standalone catalog, like Clients and Locations. The record that a Ride was handed to a Partner lives on the transfers side and holds the Partner's id. Step 13 decides how a handoff fits the Ride states.

`capacity` owns the decision whether a Driver, a Vehicle, or later a Partner is free, and it owns unavailability windows. It reads who is taken through a port it defines, and the transfers infrastructure implements that port. `capacity` does not import transfers, and it knows Drivers, Vehicles, and Partners by id. There is no occupation table, so step 16 stays without a schema change and ADR-0032 stands. If a channel manager later needs separate occupation records, only the implementation of the port changes, not its contract. Step 13 decides what a free Partner is, the locking, and the shape of the port.

`price-list` owns the price list, the zones, and the lookup. It returns a suggested price in EUR with an explanation, or no price. It knows Clients, Partners, and Locations by id. It holds which zone a Location is in; Locations know nothing of prices. The price snapshot is a field of the Transfer, owned by transfers, and `price-list` does not know that Transfers exist. If step 24 needs the zone on the Location, that is a new ADR.

`invoicing` owns invoices, the provider port, the Tenant's issuer, and the provider secrets. It knows nothing of Transfers or Rides. A transfers application service checks that a Transfer may be invoiced (payment `invoice_to_agency` and the Ride done) and sends a request: the Client id, lines taken from the price snapshot, and the Transfer's id as an opaque reference. That reference is unique per Tenant, so a repeated request returns the same invoice. `invoicing` reads the Client's billing details from `clients`. The provider's number, the status, and the PDF live in `invoicing`, and a Transfer's invoice is read by its reference.

The Ride history on the Client card comes from transfers, read by `client_id` with its own role allow-list. The screen puts it beside the card. `clients` does not read transfers. A No-show count per Client follows the same path.

The import-boundary allow-list grows to this: transfers may import `clients`, `locations`, `partners`, `capacity`, `price-list`, and `invoicing`; `invoicing` may import `clients`. None of them imports transfers.

## Consequences

No Transfer is rewritten for a change of language, and phase E builds on the Transfer as it is. A channel manager can add an Order above it later without a migration of the Transfer.

An arrival and its return journey are not linked in the model. A return journey in one click, or a later Order, would add that link. A company in both roles has its contacts entered twice. The Croatian UI word differs from the reference operator's, which the UI round may soften with labels but not with terms.

Capacity reading through a port costs one adapter in transfers and moves the overlap rule out of transfers. Invoicing stays extractable to the shared starter, and transfers carries the rule of what may be invoiced. Price changes never reach a stored Transfer, because the snapshot is on the Transfer and not in the price list.
