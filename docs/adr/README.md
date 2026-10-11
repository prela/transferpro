# Architecture Decision Records

Hard-to-reverse decisions are recorded here, one file per decision: `NNNN-short-title.md` (e.g. `0001-multi-tenancy.md`).

## Format (Michael Nygard)

Each ADR has a title, a status, and three sections:

- **Context** — the forces at play: the problem, constraints, and options considered.
- **Decision** — what we decided, stated in full sentences ("We will …").
- **Consequences** — what becomes easier or harder as a result, good and bad.

Status: `proposed` → `accepted` (or `rejected`); later `deprecated` or `superseded by ADR-NNNN`. ADRs are written via grill-with-docs; an accepted ADR is not edited, it is superseded.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| ADR-0001 | Multi-tenancy: Better Auth organizations + `tenant_id` + Postgres RLS | accepted |
| ADR-0002 | PostgreSQL + Drizzle | accepted |
| ADR-0003 | Booking sources as ports/adapters with idempotent import (`source` + `external_id`) | proposed |
| ADR-0004 | Job queue: pg-boss on Postgres | accepted |
| ADR-0005 | Ride states | accepted; partially superseded by ADR-0008 |
| ADR-0006 | Driver acceptance | accepted; partially superseded by ADR-0008 |
| ADR-0007 | No-show | accepted |
| ADR-0008 | Office acceptance, confirmed by phone | accepted |
| ADR-0009 | Driver sees the price when payment is cash | accepted |
| ADR-0010 | Re-acceptance after the pickup, the places, or the flight change | accepted |
| ADR-0011 | Tenant session, grant-walled roles, and the member read | accepted; partially superseded by ADR-0014 |
| ADR-0012 | Logging, redaction, and error responses | accepted |
| ADR-0013 | Invitation email and the accept path | accepted |
| ADR-0014 | Append-only audit log | accepted; partially superseded by ADR-0015 and ADR-0019 |
| ADR-0015 | Settings changes in the audit log | accepted; partially superseded by ADR-0025 |
| ADR-0016 | UI: Nuxt UI + Tailwind v4 | proposed |
| ADR-0017 | A Client keeps its name off the audit log | accepted |
| ADR-0018 | Module boundaries | accepted |
| ADR-0019 | Superadmin | accepted |
| ADR-0020 | Invoice to agency is a recorded payment | accepted |
| ADR-0021 | Operational day | accepted; partially superseded by ADR-0025 |
| ADR-0022 | In progress is not a Ride state | accepted |
| ADR-0023 | Unassigned alarm | accepted |
| ADR-0024 | One office home read | accepted |
| ADR-0025 | Operational-day start | accepted |
| ADR-0026 | Driver work-order email | accepted |
| ADR-0027 | Unclosed mark | accepted |
| ADR-0028 | Live flight | accepted |
