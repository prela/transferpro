# A Client keeps its name off the audit log

Status: proposed

## Context

A dispatcher adds a Client so a Transfer can name who booked it, corrects the name and the kind, and lists the Tenant's Clients. The kind is agency, hotel, or individual. This ticket does not delete a Client. ADR-0014 and ADR-0015 say an audit entry stores ids, roles, and, for a settings change, the previous and next value. It does not store names. A Client of kind individual is a person, and an audit row is never deleted.

The alternative was to store the previous and next name, the way a wait stores its minutes. That would show the misspelling that was corrected. It would also keep a person's name forever.

## Decision

We will store Clients in `app.clients`, one table for many rows per Tenant, declared through `tenantTable()` with FORCE RLS. `name` is required, trimmed, and at most 200 characters. `kind` is `agency`, `hotel`, or `individual`. There is no delete in this ticket.

A dispatcher or an admin may list, add, and correct. A driver is refused. No session is 401.

We will record `client.created`, `client.name_changed`, and `client.kind_changed`. Each names no member (`subject_user_id` is null). `client.created` stores exactly `{ clientId, kind }`. `client.name_changed` stores exactly `{ clientId }`. `client.kind_changed` stores exactly `{ clientId, from, to }`. One changed field is one entry. A correction that matches the row appends nothing.

The name stays on `app.clients`. It is not copied into the audit row, and the log screen does not read it back from that table. Kind is not a name, so its previous and next values are stored, as a wait's minutes are.

## Consequences

The log shows who added a Client, that a name was corrected, and what the kind changed from and to. It does not show the old spelling. The current name is the clients list. A later correction overwrites the row; the earlier name is gone.
