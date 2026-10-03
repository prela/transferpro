import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { auditActions } from '../shared/audit-entry'
import { appSchema, tenantTable } from './tenant-table'

export const auditAction = appSchema.enum('audit_action', auditActions)

/**
 * Append-only (ADR-0014). The app role may only SELECT. Rows are written by
 * `audit.append_entry` and by the trigger on `auth.invitation`, and a trigger
 * refuses UPDATE, DELETE, and TRUNCATE for every role. drizzle-kit cannot
 * emit those grants, functions, or triggers; the migration SQL does.
 * User ids carry no foreign key, so an entry outlives the membership and the user.
 */
export const auditEntry = tenantTable('audit_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorUserId: text('actor_user_id').notNull(),
  action: auditAction('action').notNull(),
  subjectUserId: text('subject_user_id'),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
}, table => [
  index('audit_entry_tenant_occurred_at').on(table.tenantId, table.occurredAt.desc()),
  check('audit_entry_actor_user_id', sql`${table.actorUserId} <> ''`),
  check('audit_entry_data', sql`jsonb_typeof(${table.data}) = 'object'`),
], { oneRowPerTenant: false })
