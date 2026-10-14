# Channels and external references

Status: accepted

Damir accepted this on 14 October 2026. The Charter listed this record as a candidate, and the index carried it as proposed with no file; this is its first text. It supersedes no ADR. ADR-0035 decides how an entry is written: the transaction, the event log, the outbox, and retry.

## Context

The Charter plans bookings that arrive through a BookingSource port, each stored with `source` and `external_id`, imported idempotently, with changes and cancellations updating the existing Transfer. ADR-0033 brings the manual channel and idempotent entry into v1 and keeps every other channel out. #206 step 15 asks for a unique `(tenant_id, source, external_id)` and an idempotent create that returns the existing Transfer.

A Client often sends one voucher for an arrival and its return journey, and two Clients can use the same voucher number on the same day. If the voucher were the `external_id` of the manual channel, entering the return journey would return the arrival, and two Clients' bookings would merge into one.

The alternatives were the voucher as the `external_id` with a wider key (a direction, a sequence, or the Client), the office typing suffixes such as `/1` and `/2`, and BookingSource as the domain term with "channel" avoided.

## Decision

We will give every Transfer a Channel and an ExternalRef. The Channel is the way the Transfer reached the Tenant. The ExternalRef is the Channel plus that channel's own id for one Transfer. No two Transfers of a Tenant share one, and the same ExternalRef in two Tenants is allowed. The column is `channel`, not `source`; #206 step 15 reads that way.

Manual entry by the office is a channel. Transferpro gives each manual entry its own id, and the office does not type it. Repeating the same entry returns the existing Transfer instead of creating a second one. A Transfer stored before this record is a manual-channel Transfer. The Client is not a channel, and neither is the phone call or the message the office reads before entering the Transfer by hand.

The voucher is a Client reference: the number under which the Client keeps the booking. It is optional, typed by the office, stored as entered, and not unique. It is not part of the ExternalRef and is never a key. In v1 it is the only tie between an arrival and its return journey; the model holds no other link.

A change or a cancellation that arrives through a channel updates the Transfer its ExternalRef names. On the manual channel that is the existing Transfer correction and cancel.

BookingSource is the name of the port in code, and each channel is an adapter behind it. In v1 the only adapter is manual. Mapping to an outside standard (schema.org, OpenTravel) lives only in an adapter; domain and application code do not take their field names from it.

## Consequences

A double submit of the manual form does not create two Transfers. The office types the voucher on the arrival and again on the return journey, and finds the pair by that number.

A later email adapter takes the channel's own message or booking id as the `external_id` and puts a voucher it reads into the Client reference. A channel that sends one booking with several segments needs one `external_id` per segment, derived by its adapter. Grouping those segments is the later Order that ADR-0036 leaves possible.

The Charter's "BookingSource" and "ExternalRef (source + external_id)" read with this record; the Charter is not edited.
