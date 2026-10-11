import { sql } from 'drizzle-orm'
import { text } from 'drizzle-orm/pg-core'
import { member, user } from './auth-schema'
import { appSchema } from './tenant-table'

/**
 * The sign-in email of a driver member in the current Tenant.
 * security_invoker is off so the view owner reads auth.user. The app role
 * never receives that table. security_barrier runs the tenant predicate first.
 * Linking a Driver copies this address onto app.drivers.email. A work order
 * reads the copy. This view is not a list of every member's mailbox.
 */
export const driverSignInEmail = appSchema.view('driver_sign_in_email', {
  userId: text('user_id').notNull(),
  email: text('email').notNull(),
}).with({
  securityBarrier: true,
  securityInvoker: false,
}).as(sql`
  select ${member.userId}, ${user.email}
  from ${member}
  inner join ${user} on ${user.id} = ${member.userId}
  where ${member.organizationId} = app.current_tenant_id()::text
    and ${member.role} = 'driver'
`)
