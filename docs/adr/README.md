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
| ADR-0001 | Multi-tenancy: Better Auth organizations + `tenant_id` + Postgres RLS | proposed |
| ADR-0002 | PostgreSQL + Drizzle | proposed |
| ADR-0003 | Booking sources as ports/adapters with idempotent import (`source` + `external_id`) | proposed |
| ADR-0004 | Job queue choice (pg-boss on Postgres vs. alternatives) | proposed |
