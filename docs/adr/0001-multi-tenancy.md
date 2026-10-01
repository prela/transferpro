# Multi-tenancy: Better Auth organizations, tenant_id, and Postgres RLS

Status: accepted

## Context

Transferpro is a multi-tenant SaaS. The first Tenant is one transfer company, and a later Tenant must never read or write that company's rows. Application-level filters are easy to forget. A schema or database per Tenant isolates data more strongly, and it fights a small v1: shared migrations, shared connection pooling, and one Postgres on the existing server.

Better Auth's organizations plugin is already the Charter's account model.

## Decision

We will treat a Tenant as one Better Auth organization. Every tenant table will carry `tenant_id`. Postgres row-level security will enforce isolation, not only application code. A session will set the current Tenant before queries run. A test will prove Tenant A cannot read or write Tenant B's rows. The platform superadmin will have no routine access to tenant data, and any such access will be audited.

## Consequences

Tenant isolation holds even when a query forgets a `tenant_id` predicate. Every new tenant table needs the column, a policy, and that cross-tenant test. Domain and application code reach the database through ports, so RLS stays in infrastructure. Cross-tenant reporting and a self-serve superadmin browser are harder, and they are out of v1.
