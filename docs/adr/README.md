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
| ADR-0003 | Channels and external references | accepted |
| ADR-0004 | Job queue: pg-boss on Postgres | accepted |
| ADR-0005 | Ride states | accepted; partially superseded by ADR-0008 |
| ADR-0006 | Driver acceptance | accepted; partially superseded by ADR-0008 |
| ADR-0007 | No-show | accepted |
| ADR-0008 | Office acceptance, confirmed by phone | accepted |
| ADR-0009 | Driver sees the price when payment is cash | accepted |
| ADR-0010 | Re-acceptance after the pickup, the places, or the flight change | accepted |
| ADR-0011 | Tenant session, grant-walled roles, and the member read | accepted; partially superseded by ADR-0014 |
| ADR-0012 | Logging, redaction, and error responses | accepted |
| ADR-0013 | Invitation email and the accept path | accepted; partially superseded by ADR-0037 |
| ADR-0014 | Append-only audit log | accepted; partially superseded by ADR-0015 and ADR-0019 |
| ADR-0015 | Settings changes in the audit log | accepted; partially superseded by ADR-0025 |
| ADR-0016 | UI: Nuxt UI + Tailwind v4 | accepted; partially superseded by ADR-0038 and ADR-0040 |
| ADR-0017 | A Client keeps its name off the audit log | accepted |
| ADR-0018 | Module boundaries | accepted; partially superseded by ADR-0033 |
| ADR-0019 | Superadmin | accepted |
| ADR-0020 | Invoice to agency is a recorded payment | accepted; partially superseded by ADR-0033 |
| ADR-0021 | Operational day | accepted; partially superseded by ADR-0025 |
| ADR-0022 | In progress is not a Ride state | accepted |
| ADR-0023 | Unassigned alarm | accepted; partially superseded by ADR-0039 |
| ADR-0024 | One office home read | accepted; partially superseded by ADR-0039 |
| ADR-0025 | Operational-day start | accepted |
| ADR-0026 | Driver work-order email | accepted |
| ADR-0027 | Unclosed mark | accepted; partially superseded by ADR-0039 |
| ADR-0028 | Live flight | accepted |
| ADR-0029 | Ride occupation | accepted |
| ADR-0030 | Landing alarm | accepted; partially superseded by ADR-0039 |
| ADR-0031 | Maps for Locations behind a port | accepted |
| ADR-0032 | Board warnings are derived on read | accepted |
| ADR-0033 | v1 scope: price list, invoices through a provider, Client card, and Partner record | accepted |
| ADR-0036 | The Transfer is the order, and who owns the v1 modules | accepted |
| ADR-0037 | Console mailer on preview | accepted |
| ADR-0038 | Office and driver UI: layouts, navigation, and density | accepted |
| ADR-0039 | Urgent and warning tiers, and live refresh | accepted |
| ADR-0040 | Theme tokens and contrast rules | accepted |
| ADR-0041 | Revoke a pending invitation | accepted |
