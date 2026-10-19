# Invitation outbox entry after the Better Auth commit

Status: accepted

Damir accepted this on 19 October 2026, in #331.

Recorded with #331, from spec #325. It amends one sentence of ADR-0045, named below. Everything else in ADR-0045 holds for invitations.

## Context

ADR-0045 writes the outbox entry "in the same transaction as the Ride change or the invitation". A Ride change and its entry are both on the app pool, so they share one transaction. An invitation is not. Better Auth creates it on the auth pool, which cannot read the `app` schema. The outbox entry is a tenant table on the app pool, which cannot read `auth`. One Postgres transaction cannot span the two pools without granting one role the other's schema, and ADR-0013 and the RLS rules keep them apart.

## Decision

The invite call checks the Admin role and the Tenant settings row on a tenant transaction that commits before Better Auth is called. No Better Auth call runs inside a tenant transaction.

We will write an invitation's outbox entry on its own tenant transaction, right after Better Auth commits the invitation. That transaction records the entry and enqueues the pg-boss job for one minute later, as ADR-0045 describes. The first attempt then runs on a further tenant transaction, and the invite call waits for it.

When that write fails, the invitation exists and has no entry. The invite call still returns the copyable link and reports the mail as not sent. It writes one log line, `mail_outbox.invitation_not_recorded`, with the event name only: no invitation id and no address. Nothing will retry that mail. The Admin can copy the link, or revoke and invite again.

Better Auth sends no invitation mail. Its own invite route is disabled, so every invitation goes through the route that writes the entry.

## Consequences

A crash or a database error between the two commits leaves an invitation with no mail and no entry. The Admin sees "not sent" on the dialog, not "we will try again", so they know to share the link. Home does not list it, because Home lists outbox entries.

A process that dies after the entry commits is still covered by the queued job, as for a work order.

### Amended

ADR-0045: "The entry is written in the same transaction as the Ride change or the invitation." For an invitation, the entry is written on the next tenant transaction after the invitation commits.
