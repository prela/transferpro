# Module boundaries

Status: accepted

## Context

A Transfer names a Client and, once Locations exist, a start and an end. Invoicing comes later and is outside v1. Those three are catalogs and documents a second application could use without the dispatch board. Folding them into the transfers module would make a later extraction a rewrite. Designing a shared starter before either application is in production would freeze a boundary nobody has used.

`app.clients` already exists (ADR-0017, migration `0007_clients.sql`). Locations are issue #55. A Transfer's start and end are chosen from that list in #18. Damir accepted this boundary on 5 October 2026.

## Decision

We will keep Clients, Locations, and later Invoicing as standalone modules. Each has its own tables, application services, API routes, and a contract in `shared/<module>`.

Transfers depend on these modules. The dependency does not run the other way. Clients and Locations have no foreign key, import, or query that points at a transfer table. Another module reaches them only through that module's public `index.ts`, and references a row by id.

When the transfers module lands (#18), the import-boundary lint's allow-list is this direction: transfers may import Clients, Locations, and later Invoicing. Those modules do not import transfers.

v1 Clients stay a name and a kind. We will not build CRM. Later contact people, notes, and history are new child tables keyed by `client_id`, each with `tenant_id` and FORCE RLS (ADR-0011). `app.clients` is not split to hold them.

Locations are issue #55. Transfers choose the start and the end from Locations (#18).

These modules are built so they can be extracted into a shared starter after Transferpro is in production, taken from two real applications. The starter is not designed up front.

## Consequences

A later CRM adds tables beside `app.clients`. Migration `0007_clients.sql` and `db/clients.ts` do not block that: the table is `tenant_id`, `id`, `name`, and `kind`, with no free-text contact column.

Clients and Locations can move to a starter without dragging Transfer tables with them. Until a second application exists, they stay in this repo.

The import-boundary allow-list arrives with #18, when a transfers module exists to allow.
