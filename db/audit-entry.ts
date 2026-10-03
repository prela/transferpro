import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { auditActions, tenantRoleSchema } from '../shared'
import { appSchema, tenantTable } from './tenant-table'

export const auditAction = appSchema.enum('audit_action', auditActions)

// drizzle-kit writes a check's SQL into the migration as text, so literals are raw, never parameters.
const tenantRoles = sql.raw(tenantRoleSchema.options.map(role => `'${role}'`).join(', '))

/** `data` holds exactly `keys`, and each one is a Tenant role. */
function rolesOnly(data: AnyPgColumn, ...keys: string[]) {
  return sql.join([
    sql`${data} - ${sql.raw(`'{${keys.join(',')}}'::text[]`)} = '{}'::jsonb`,
    ...keys.map(key => sql`${data} ->> ${sql.raw(`'${key}'`)} in (${tenantRoles})`),
  ], sql` and `)
}

/**
 * Append-only (ADR-0014). The app role may only SELECT. Rows are written by
 * `audit.append_entry` and by the trigger on `auth.invitation`, and a trigger
 * refuses UPDATE, DELETE, and TRUNCATE for every role. drizzle-kit cannot
 * emit those grants, functions, or triggers; the migration SQL does.
 * User ids carry no foreign key, so an entry outlives the membership and the user.
 *
 * `audit_entry_shape` repeats `auditFactSchema` in the database, so no writer
 * can store a name or an email in a row that is never deleted. A new action
 * needs a branch here, or its rows are refused. Postgres checks constraints in
 * name order, so `audit_entry_data` refuses a non-object before the shape is read.
 */
export const auditEntry = tenantTable('audit_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorUserId: text('actor_user_id').notNull(),
  action: auditAction('action').notNull(),
  subjectUserId: text('subject_user_id'),
  data: jsonb('data').notNull(),
}, table => [
  index('audit_entry_tenant_occurred_at').on(table.tenantId, table.occurredAt.desc()),
  check('audit_entry_actor_user_id', sql`${table.actorUserId} <> ''`),
  check('audit_entry_data', sql`jsonb_typeof(${table.data}) = 'object'`),
  check('audit_entry_shape', sql`(case ${table.action}
    when 'member.invited' then ${table.subjectUserId} is null and ${rolesOnly(table.data, 'role')}
    when 'member.role_changed' then ${table.subjectUserId} <> '' and ${rolesOnly(table.data, 'from', 'to')}
    when 'member.removed' then ${table.subjectUserId} <> '' and ${rolesOnly(table.data, 'role')}
    else false end) is true`),
], { oneRowPerTenant: false })
