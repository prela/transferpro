# v1 scope: price list, invoices through a provider, Client card, and Partner record

Status: accepted

Damir accepted this on 14 October 2026. It partially supersedes ADR-0018 and ADR-0020; the sentences are listed below. The Charter is not edited, which follows the precedent of ADR-0028 and ADR-0031. This does not reopen the decisions that #206 lists as locked.

## Context

The Charter keeps v1 thin: take a booking, assign the Ride, and record how it ended. It lists invoicing, fiscalization, price-list automation, and a Partner handoff beyond a free-text note as v1 non-goals, and it puts CRM on Clients under future direction. On 14 October 2026 the owner decided that v1 is the tool a dispatcher uses to run the business, not only a board for placing Vehicles. The first Tenant's working day on production has to cover the fleet, Locations on a map, Client and Partner records, a price list, a Transfer with a channel and an external id, an assignment checked against capacity, the Driver closing the Ride, and an invoice issued through a fiscalization provider (#206).

The alternatives were to keep v1 as the Charter wrote it and ship these modules after the pilot, or to build our own fiscalization. The first leaves the first Tenant running half of the business in another tool beside ours. The second is a legal product of its own, and the rules differ by country.

## Decision

### In v1

- **Price list.** A price list suggests the price of a Transfer. The office may override it by hand. The price is stored on the Transfer as a snapshot that does not change once it is stored. What an article is, zones, a price per Client or Partner, and the return leg are decided in step 24 of #206.
- **Invoices through a provider.** The office issues an invoice for one Transfer to the Client named on it, through a fiscalization provider's API. Only a Transfer whose payment is `invoice_to_agency` and whose Ride is done gets one. Invoicing is its own module (ADR-0018). The Tenant keeps issuing cash and card receipts to guests in its existing tool. Which form Croatian law requires (a fiscalized invoice, eRačun) comes from research #225, and step 27 may widen this decision on that finding. The decision names no vendor.
- **Client card.** A Client gains contact people, notes, and the history of its Rides, in new child tables keyed by `client_id` (ADR-0018). The guest stays a name on the Transfer and is not a CRM record.
- **Partner record.** A Partner is a subcontractor company, as `GLOSSARY.md` defines it. The office keeps a Partner's record and can record that a Ride was handed to that Partner. A Partner has no login. How a handoff fits the Ride states is decided in step 13 of #206. If it needs a change to ADR-0005, ADR-0006, or ADR-0008, that change is a new ADR.
- **Order identity and Capacity.** A manually entered Transfer has a channel (`source`) and an `external_id`, and entry is idempotent. Capacity is a module, and an assignment is checked against it. ADR-0034 and ADR-0035 decide both.

This record says Transfer where #206 says order. Step 2 of #206 decides whether Order becomes its own term, and which module owns Capacity, pricing, and invoicing.

### Superseded

In `CHARTER.md`, which stays as written:

1. In the v1 non-goals, four items: "Invoicing"; "fiscalization", but only through a provider, since our own fiscalization stays out; "price-list automation"; and "Partner handoff workflow beyond a free-text note", where a recorded handoff is in and an offer flow, SLAs, commissions, and a Partner login stay out.
2. In the v1 thin slice, "price as free number". The free number stays as the manual override of the suggested price, and the price is stored as a snapshot.
3. In module 6, "Partners and commissions, invoicing; fiscalization later." Partners, invoicing, and fiscalization through a provider are v1. Commissions stay out.
4. In future direction, under CRM on Clients, "v1 Clients stay simple". Contact people, notes, and Ride history are v1. Communication history, offers, and a pipeline stay future work. Growing through new tables keyed by the Client stands.
5. In future direction, under Invoicing, "v1 records only the price and the payment method." and "come later" in "Real invoices, fiscalization, and Croatian eRačun come later through an external service or integration, as their own module". Invoices are v1, through an external service, as their own module.
6. In the WBS, "Phases 7+ are not v1." and row 7+, for the price list, Partners without commissions, invoicing, and fiscalization through a provider. Row 6.x, "BookingSource port; manual + email adapters; idempotent import", depends on "v1 done"; the manual channel and idempotent entry are v1, while the email adapter and every other channel stay out.

In ADR-0018:

1. In the context, "Invoicing comes later and is outside v1."
2. In the decision, "v1 Clients stay a name and a kind. We will not build CRM." Child tables keyed by `client_id`, each with `tenant_id` and FORCE RLS, stand, and so does "`app.clients` is not split to hold them."
3. The word "later" in "Clients, Locations, and later Invoicing" and in "Later contact people, notes, and history". Clients, Locations, and Invoicing stay standalone modules.

In ADR-0020:

1. In the context, "Invoicing itself is not v1."
2. In the decision, "We will not send an invoice in v1." `invoice_to_agency` stays a recorded choice. The Driver's phone still hides the price and the payment method for it.

The rest of the Charter, ADR-0018, and ADR-0020 stands, including the deadline, the thin-v1 aim, GDPR export and delete before a second paying Tenant, and every other non-goal.

### Pilot acceptance

The pilot is accepted when all of these hold:

- The first Tenant runs one real operational day on production with at least one Ride, and every Ride of that day is in Transferpro, not in the previous tool.
- At least one Transfer goes through every point of the #206 destination, at the least depth that the #206 cut list allows.
- That Transfer's invoice is real: issued through the provider on production, not in a sandbox.
- #31 passes in Croatian and in English, in the light and the dark theme.
- The pre-pilot security gate and the restore test from #206 have passed.

If invoicing is cut to its last resort, an export that the first Tenant issues by hand, the pilot is not accepted.

### Out of v1

- Channel manager: partner portal and API, web booking widget, syncing status back to channels, per-channel pricing, a cross-Tenant marketplace, the uncovered-order offer flow, Partner SLAs.
- Email import and AI parsing of orders.
- A Gantt with drag and drop, and the day lock.
- GPS, guest tracking, guest messaging.
- Several issuing companies inside one Tenant.
- Our own fiscalization, a payment gateway, online payment, public booking, coupons.
- Monthly batch invoicing, Partner commissions, revenue KPIs, Driver payouts.
- One user in several Tenants.
- GDS/OTA connectors.
- Native apps, billing of Tenants, extracting the shared starter, swarm.

These are not v1 unless the UI round of #206 or a later grill brings one in through an owner decision or an ADR: an alarm inbox with acknowledge and snooze; a thin day timeline on the board; Ride steps on the phone beyond accept, done, and no-show; faster entry (duplicate a Ride, a return leg in one click, recurring Rides, an assignment suggestion, global search); restricted zones and occupation minutes per Ride beyond the ADR-0029 window; Driver and Vehicle documents with expiry dates; a paper fallback when the system is down; a signed PDF work order; GDPR export and delete.

## Consequences

The first Tenant can run the business in one tool on the pilot day, from the Transfer to the invoice. The cost is a v1 roughly three times the old one, with about a dozen migrations for the owner to review. Price list, Capacity, and Invoicing are the first modules with domain and application tiers, so the first of them sets the pattern and takes longer.

The pilot depends on a provider outside our control. If its access arrives late, invoicing is at risk, and the last-resort cut misses the pilot. A No-show is not invoiced, because ADR-0007 still charges nothing. A cash or card Transfer gets no invoice from Transferpro.

A Partner with no login means the office records every handoff. The Charter's open question about a Partner login is answered for v1; its commission rules stay open and out.

The Charter text still reads as before. A reader of a superseded sentence reads it with this record until the owner updates the Charter.
