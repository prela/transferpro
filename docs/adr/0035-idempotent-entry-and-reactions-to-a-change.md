# Idempotent manual entry, and reactions to a change without an event log

Status: accepted

Damir accepted this on 20 October 2026, in the step 14 grill of #206. It partially supersedes ADR-0003; the sentence is named below. It does not decide ADR-0026's "The send is not retried.": ADR-0045 does. ADR-0004 and ADR-0014 stand.

## Context

ADR-0003 gives every Transfer a Channel and an ExternalRef, makes manual entry a channel whose id Transferpro assigns, and leaves to this record how an entry is written: the transaction, the event log, the outbox, and retry. Step 14 of #206 also asked that a status change write an event in the same transaction, how that event relates to the audit log, and how pg-boss relays it.

Every Ride state change and every Transfer write already appends an audit entry on its own transaction, with ids and field names only (ADR-0014). pg-boss lives in the same database, and the job queue port inserts a job on the caller's transaction, so a rollback removes it (ADR-0004). The mail outbox already carries work orders and invitations, written beside the change it follows (ADR-0045, ADR-0047). No v1 module consumes a Ride status change: syncing status back to a channel is out of v1 (ADR-0033), and the office issues an invoice by hand, with a reference unique per Transfer (ADR-0036). The glossary tells the reader not to call an audit entry an event.

Before this record, posting the Transfer form twice records two Transfers. Nothing in the database marks which Transfers were stored before a Channel existed, and the table has no creation time.

The alternatives were an event table beside the audit log with its own relay; the audit log read by a relay with a cursor; a ride-state hook every command calls with no subscriber; the idempotency key in an `Idempotency-Key` header; a server-assigned `external_id` plus a separate short-lived key; comparing the repeated payload and refusing a different one; applying a different payload as a correction; leaving `external_id` empty on existing rows; a `BookingSource` port with a manual adapter now; and a trigger that refuses a change of the ExternalRef.

## Decision

### No event log in v1

We will not add an event table. The audit entry is the only record that a change happened. A reaction to a change is a pg-boss job inserted through the job queue port on the transaction of that change, so the change and the job commit or roll back together. Mail always goes through `app.mail_outbox`. When a real consumer arrives, such as a channel manager, an event table is introduced by a new ADR.

Every job follows four rules. It is enqueued on the transaction of the change it follows. Its payload holds only ids, field names, the instant a tick asked, and enum values, never a name, an address, a phone, an email, or free text. Its handler is idempotent, because pg-boss delivers at least once. Its Tenant comes from the envelope, never from the payload.

Every job name registers a Zod schema for its payload. The port refuses an unknown name and a payload that does not pass its schema, on enqueue, on publish from a tick, and on schedule. A refused job is not inserted. Parsing the payload with the same schema when a job is received is left for a later change.

### Idempotent manual entry

The Transfer form creates the manual channel's `external_id` when it opens: a blank form, a duplicate, or a return journey. The id is a random UUID. It is kept in the local draft, so a reload after a lost response sends the same id. It is sent in the request body. The server stores it as `external_id` with `channel` set to `manual`. The office never sees or types it.

When an `external_id` arrives that the Tenant already has on the same channel, the server returns that existing Transfer and its Ride, marked as already recorded, and writes nothing: no row, no audit entry, and no job. A different payload under the same id is not applied. Two concurrent requests with one id are settled by the unique key: the losing insert reads and returns the existing Transfer. A repeated entry writes one info log line with the Transfer id only.

When the answer is "already recorded", the form keeps the local draft until the Dispatcher confirms the notice. The notice keeps the Dispatcher's own values in view so they can enter them through a Transfer correction. The draft is cleared only after that confirmation.

`channel` is `text not null` with the default `manual` and a check on the known channels, which is only `manual` in v1. `external_id` is `text not null`, unique per Tenant together with `channel`. Its type is text so a later channel can store its own message or booking id. The migration adds `external_id` with the default `gen_random_uuid()::text`, which rewrites the table once and gives every stored Transfer its own id, then drops that default in the same migration. There is no `UPDATE` statement. After that, an insert without an `external_id` fails. A later import, including one from the reference operator's previous tool, assigns its own `external_id`.

`channel` and `external_id` never enter an audit entry or a log line, and `transfer.created` keeps its shape. They are not in any API response, screen, CSV export, or search. A Transfer correction has its own body schema, with no key, and refuses one as an unknown field. No `UPDATE` sets either column. There is no trigger: that rule is kept by code and proven by a route test.

### The BookingSource port waits for a second channel

In v1, manual entry is the manual channel without a port. `channel` is the constant `manual`, and the idempotent create lives in the Transfer insert. The `BookingSource` port is built with the second channel, or with an import from the reference operator's previous tool, whichever comes first. Mapping to an outside standard still lives only in an adapter (ADR-0003).

### Superseded

ADR-0003: "BookingSource is the name of the port in code, and each channel is an adapter behind it. In v1 the only adapter is manual." BookingSource stays the name of that port, and it is built when the second channel or an import arrives. The rest of ADR-0003 stands.

## Consequences

A double submit, a retry, or a reload of the Transfer form never stores two Transfers. A Dispatcher who changed a field before resending sees that the entry was already recorded and keeps their changes until they confirm, instead of losing them in silence. Every Transfer in the database has an ExternalRef, and an insert that forgets one fails.

There is one outbox for mail and one queue for everything else. Nothing duplicates the audit log. A future reaction, such as an invoice request, is one job with an ids-only payload on the transaction of the change. A channel manager that needs a replayable stream of changes needs a new ADR and its own table.

The job payload check runs where a job is written, not where it is read, so a handler still parses its own payload until a later change moves that check to the receiving side. Every new job adds a schema, or the port refuses it.

The one-time rewrite runs on development and preview data. Production has no Transfers before step 37 of #206. Every test, fixture, and seed that inserts a Transfer has to supply an `external_id`.
