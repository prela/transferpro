# Client card and Partner record

Status: accepted

Damir accepted this on 20 October 2026, in the step 18 grill of #206. It extends ADR-0018 and ADR-0036 and supersedes none of their sentences. ADR-0033 brought the Client card and the Partner record into v1; ADR-0048 and ADR-0034 decide the handoff and when a Partner is free.

## Context

ADR-0033 gives a Client contact people, notes, and the history of its Rides, and gives the office a record of each Partner. ADR-0018 keeps `app.clients` as it is and puts anything new about a Client in child tables keyed by `client_id`. ADR-0036 puts the Ride history in `transfers`, read by `client_id`, so that `clients` never reads transfers. The Charter keeps communication history, offers, and a pipeline out of v1. A contact person is personal data, and AGENTS.md allows no `DELETE` grant without an ADR.

The alternatives were a phone and an email on the Client itself; a primary contact; removed contacts kept forever, or deleted at once by the office; a list of dated notes; contact persons for a Partner; billing details on the Client now; and archiving a Client.

## Decision

### Client card

A Client may have contact persons. Each has a name of at most 200 characters, may have a role as free text of at most 100 characters, and has a phone, an email, or both. A Client of any kind may have several, and none is the main one. They live in a child table of `clients`, keyed by the Tenant and the Client together, with the full RLS set. `app.clients` does not change.

Removing a contact person marks it removed, and it no longer shows. A daily job of `clients` deletes contact persons removed more than 90 days ago. This record is the ADR that allows that `DELETE` grant. The grant is limited to that table, and a restrictive policy lets it delete only rows removed more than 90 days ago, as ADR-0034 does for unavailability windows. Correcting a contact person overwrites the old value.

A Client has at most one Client note, a standing text of at most 2000 characters that a correction replaces. Saving an empty note clears it. It lives in its own child table of `clients`, one row per Client. There is no list of dated notes.

Each contact person and the Client note carry their own version (ADR-0046). A correction or a removal made from an older version is a stale save. Adding a contact person needs no version. Two first saves of the same Client note at once leave one, and the other is a stale save. A contact or note save does not change the Client's own version.

The audit log records a contact person added, changed, or removed with the Client id, the contact person id, and the field names, and the Client note saved with the Client id and the field name. It never holds a name, a role, a phone, an email, or the note's text (ADR-0017).

The billing details that invoicing will read (ADR-0036) get their own one-row-per-Client child table in `clients`. Step 27 of #206 decides their fields, after research #225. Step 19 does not build them.

A Client is still not archived or deleted in v1.

### Partner record

A Partner has a name, and may have one phone, one email, and a note, all on its own row in `partners`. The name is not unique. It has no contact persons, no kind, no login, and no mail. A Partner is archived and restored, never deleted. An archived Partner cannot be handed a new Ride or become the Partner of a handed-off Ride; that refusal is the archived one in the ADR-0034 order. A Ride already handed to it keeps it, still shows its name, and can be closed, taken back, or given to an active Partner. Archiving is allowed at any time. Its audit entries hold the Partner id and, when it is created or changed, the field names.

### Ride history and where the card shows

The Ride history of a Client, and of a Partner, is a read in `transfers` by that id, office only. It lists the Rides of every state, newest pickup first, 50 rows per page, and counts the total, done, No-show, and cancelled. v1 adds no index on `client_id` for it. `clients` and `partners` never read transfers.

Every route for contact persons, the Client note, Partners, and the Ride history is office only: an Admin or a Dispatcher. A Driver gets 403.

The Ride detail shows the Client's contact persons and Client note, and, on a handed-off Ride, the Partner's phone and email. The Transfer form shows the Client note once a Client is chosen. `transfers` reads them through the public entries of `clients` and `partners`. The Driver's phone shows none of them. The Client list search stays by name.

## Consequences

The office keeps who to call at each Client without changing `app.clients`, and an invoice can later read billing details from the same module. A removed contact person stays in the database for up to 90 days and is then gone; the audit log keeps only its id. The app role holds one more limited `DELETE` grant, and a third retention job runs beside those of ADR-0034 and ADR-0045.

One standing Client note cannot show who wrote what and when; it is not communication history. A Partner with several people to call keeps them in its note. A company in both roles still has its contacts entered twice (ADR-0036).

A Client that no longer books stays in the Transfer form's list, because a Client cannot be archived.
