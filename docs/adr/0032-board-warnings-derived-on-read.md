# Board warnings are derived on read

Status: accepted

Specified on issue #212, 14 October 2026. This does not supersede ADR-0023, ADR-0024, or ADR-0030. Issue #30 is superseded by this decision.

## Context

Issue #30 planned a scheduled job that stores a dispatcher warning set and upserts it on each scan. ADR-0023, ADR-0024, and ADR-0030 instead derive the unassigned alarm, the home lists, the unclosed mark, and the landing alarm when the page is read, and send nothing. Every warning is a function of Ride state, the clock, Tenant settings, the roster, and document dates.

## Decision

We will derive every office warning and alarm when the page is read. There is no stored warning set and no scheduled scan for warnings. Nothing is sent.

## Consequences

A page left open does not gain a warning until the next read. A warning has no history and cannot be acknowledged. Sending a warning by mail or push later, or acknowledging one, needs a new ADR and a store.
