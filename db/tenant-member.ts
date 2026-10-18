import { sql } from 'drizzle-orm'
import { text, uuid } from 'drizzle-orm/pg-core'
import { member, user } from './auth-schema'
import { appSchema } from './tenant-table'

/**
 * The only member read for the app role.
 * security_invoker is off so the view owner (the migrator) reads auth.*,
 * and the app role never receives those tables. security_barrier keeps a
 * caller's filter from running before the tenant predicate.
 * Organization ids are text; the session setting is a uuid.
 */
export const tenantMember = appSchema.view('tenant_member', {
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  // The day read joins the author and requires this tenant on that join.
  // Organization ids are the tenant uuid stored as text.
  tenantId: uuid('tenant_id').notNull(),
}).with({
  securityBarrier: true,
  securityInvoker: false,
}).as(sql`
  select ${member.userId}, ${user.name}, ${member.role}, ${member.organizationId}::uuid as tenant_id
  from ${member}
  inner join ${user} on ${user.id} = ${member.userId}
  where ${member.organizationId} = app.current_tenant_id()::text
`)
