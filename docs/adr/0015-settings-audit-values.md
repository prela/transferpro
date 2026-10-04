# Settings changes in the audit log

Status: accepted

## Context

ADR-0014 says an entry stores user ids and roles, and not names or emails. A change to a No-show wait or the Tenant time zone is a value, not a role. The row is never deleted, so it still cannot hold a name, an email, or an invitation id.

## Decision

We will record `settings.airport_wait_changed`, `settings.elsewhere_wait_changed`, and `settings.time_zone_changed`. Each names no member (`subject_user_id` is null). `data` is exactly `{ from, to }`: the previous and next wait in minutes, or the previous and next IANA time zone.

This supersedes one sentence of ADR-0014. An entry stores user ids, roles, and, for these three actions, those two values. It still does not store names, emails, or invitation ids.

The shape is checked by Zod before `audit.append_entry` and by `audit_entry_shape`. A wait is an integer from 1 to 1440. A time zone is a name `Intl.DateTimeFormat` accepts, at most 64 characters. Postgres has no zone catalog, so the table check bounds the length and Zod checks the name.

## Consequences

The log shows what the wait or the zone was. The waits themselves stay on `app.tenant_settings` and are read when a No-show is attempted. They are not copied onto a Ride.

`UTC` and `Etc/UTC` are valid names and are allowed. A name Intl cannot format is refused before the append.
