import type { BuildExtraConfigColumns } from 'drizzle-orm/column-builder'
import type { PgColumnBuilderBase, PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { pgPolicy, pgRole, pgSchema, uuid } from 'drizzle-orm/pg-core'

/** Tenant tables only. Better Auth uses `auth`; the queue uses `pgboss`. */
export const appSchema = pgSchema('app')

/**
 * Runtime role from docker init. `.existing()` keeps drizzle-kit from creating it.
 * It has no BYPASSRLS; the policy below is what it is allowed to see.
 */
export const appRole = pgRole('transferpro_app').existing()

type TenantColumns = Record<string, PgColumnBuilderBase>

type TenantTableColumns<TColumns extends TenantColumns> = TColumns & {
  tenantId: ReturnType<typeof uuid>
}

/**
 * The only constructor for a tenant table.
 * `tenant_id` defaults to `app.current_tenant_id()`, which is NULL when the
 * transaction never called set_config, so an insert without a tenant fails closed.
 * One policy, for the app role: the row's tenant is the transaction's tenant.
 * drizzle-kit can ENABLE RLS but cannot FORCE it; the migration SQL does.
 */
export function tenantTable<TName extends string, TColumns extends TenantColumns>(
  name: TName,
  columns: TColumns,
  extra?: (
    table: BuildExtraConfigColumns<TName, TenantTableColumns<TColumns>, 'pg'>,
  ) => PgTableExtraConfigValue[],
) {
  return appSchema.table(name, {
    tenantId: uuid('tenant_id').primaryKey().default(sql`app.current_tenant_id()`),
    ...columns,
  }, (table) => {
    const policy = pgPolicy('tenant_isolation', {
      for: 'all',
      to: appRole,
      using: sql`${table.tenantId} = app.current_tenant_id()`,
      withCheck: sql`${table.tenantId} = app.current_tenant_id()`,
    })
    const rest = extra?.(table) ?? []
    return [policy, ...rest]
  }).enableRLS()
}
