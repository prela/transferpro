# PostgreSQL and Drizzle

Status: accepted

## Context

Ride assignment, the audit log, and row-level security all need a relational database with real transactions. The Charter already forbids a second datastore in v1. Prisma and Kysely were the other TypeScript options. Prisma owns a heavier client and a separate migration engine. Hand-written SQL avoids a query builder and pushes schema drift into review.

## Decision

We will use PostgreSQL as the only database, and Drizzle as the schema and query layer. Drizzle migrations are committed for owner review and applied only to local and test databases by agents. Domain and application code will not import Drizzle. They will use ports.

## Consequences

Schema, migrations, and row-level security live next to the SQL. Swapping the ORM later means rewriting the infrastructure adapters, not the domain. A migration that drops or rewrites data stays an owner decision. Teams that expect Prisma's client will not find it here.
