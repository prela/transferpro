# Tenant session, grant-walled roles, and the member read

Status: accepted; partially superseded by ADR-0014

ADR-0014 amends "`transferpro_auth` can touch Better Auth's tables only." The auth role may also use schema `audit` and execute `audit.append_entry`, and it still has no grant on schema `app`. The rest of this decision stands.

## Context

ADR-0001 requires `tenant_id` and Postgres row-level security on every tenant table. ADR-0002 keeps Drizzle out of domain and application code. ADR-0004 runs pg-boss on the same Postgres, and a job must be able to commit with the write it follows.

Login looks up a person before any Tenant is chosen, so Better Auth's tables cannot sit behind the tenant policy. A superuser bypasses row-level security, so the role that runs migrations cannot be the role that runs the app. The app still has to show a Tenant's members by name and role: a Driver is one member whose role is driver, and the board shows that name. Giving the app role the `auth` tables would expose every Tenant's emails and sessions. Locale is the user's choice; a Tenant only supplies the default.

## Decision

We will open one transaction per application call and set `app.tenant_id` for that transaction only. The setting is copied from a `TenantContext` minted by the kernel, either from a session with one active organization and exactly one role (`admin`, `dispatcher`, or `driver`), or from a queue envelope stamped at enqueue. A superadmin has no membership and cannot mint a context. Callers do not pass `tenant_id`. Nested use of the same context throws.

Tenant tables live in schema `app` and are declared only through `tenantTable()`. That helper adds `tenant_id`, enables and forces row-level security, and adds one policy for the app role: the row's `tenant_id` equals `app.current_tenant_id()`. An unset setting yields NULL, so inserts fail and selects match nothing. A catalog test fails if any table in `app` lacks that shape, or if any Better Auth table has row-level security or a grant to the app role.

Four login roles share one Postgres. `transferpro_owner` runs migrations. `transferpro_app` is the runtime role: no superuser, no `BYPASSRLS`, DML on `app`, and DML (not DDL) on schema `pgboss` so `send` can join the transaction through pg-boss's Drizzle adapter. `transferpro_auth` can touch Better Auth's tables only. `transferpro_queue` owns schema `pgboss` and has no grant on `app` or on Better Auth. Boot refuses to start if any runtime role is over-privileged. The migrator URL is not part of the app environment. Local passwords are created by the database-roles wizard and are not committed. CI mints ephemeral passwords in the job. `REVOKE` from `PUBLIC` comes before any grant.

Better Auth's tables are not tenant tables. The app role has no privilege on them. Schema `auth` is where they go. If the adapter cannot emit that schema, the same revoke is applied table by table. The invariant is the grant.

Members are read through the view `app.tenant_member`. It is owned by `transferpro_owner`, `security_barrier` is on, and `security_invoker` is off. It selects schema-qualified `auth.member` and `auth.user`, returns only `user_id`, `name`, and `role`, and keeps rows whose organization id equals `app.current_tenant_id()`. The app role may `SELECT` the view and nothing else. An unset setting returns no rows. The view is not granted insert, update, or delete. A later Driver row may reference `auth.user` by id; the name on the board is read from this view inside the tenant transaction.

The first tenant table is `app.tenant_settings`, with `default_locale` (`hr` or `en`) and an IANA time zone. There is no settings HTTP route in the foundation package. A user's locale is stored on the Better Auth user and read by the auth role when the actor is resolved. A null user locale means the Tenant's `default_locale`.

Enqueue uses the Drizzle transaction and pg-boss `fromDrizzle`. The job's Tenant comes from the context. Rollback removes the job. This package registers no production job.

Formatting is Antfu ESLint. Prettier is not installed, and `.husky/pre-commit` runs lint-staged with `eslint --fix`. Once `pnpm typecheck` and the unit test script exist, that hook runs those two as well. The cross-tenant suite stays on CI, because it needs Postgres.

Domain modules live under `server/modules/`. The kernel is `server/core/`: a framework-free `index.ts`, a lint-gated `infrastructure.ts`, and a test-only `testing.ts`. Nuxt's `modules/` directory is left for Nuxt modules.

## Consequences

A forgotten `tenant_id` predicate still returns no other Tenant's rows. A forgotten filter on members is the same, and it cannot return an email. Better Auth keeps working with no tenant setting. Adding a tenant table without `tenantTable()` fails the catalog test.

The Driver ticket reads names from `app.tenant_member` and refuses a member whose role is not driver. It does not query Better Auth's tables.

Four database URLs are part of local setup. Coolify's role creation is a later wizard, when a deploy exists. The foundation wizard does not invent that hosting UI.

A pre-commit hook that ran the full test script would require Docker on every commit. The unit script is the hook; the policy test is CI. Prettier was removed so the hook and the charter do not format with two tools.
