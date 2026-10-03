import { sql } from 'drizzle-orm'
import { text, timestamp } from 'drizzle-orm/pg-core'
import { invitation } from './auth-schema'
import { appSchema } from './tenant-table'

/**
 * The only invitation read for the app role.
 * Same shape as app.tenant_member: the view owner reads auth.invitation,
 * security_barrier runs the tenant predicate first, and the email stays
 * off the view. The id is not a secret inside the tenant session; the
 * bearer secret is the link handed to the invitee.
 */
export const tenantInvitation = appSchema.view('tenant_invitation', {
  id: text('id').notNull(),
  role: text('role'),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
}).with({
  securityBarrier: true,
  securityInvoker: false,
}).as(sql`
  select ${invitation.id}, ${invitation.role}, ${invitation.status}, ${invitation.expiresAt}
  from ${invitation}
  where ${invitation.organizationId} = app.current_tenant_id()::text
`)
