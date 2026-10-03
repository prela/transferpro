import type { AuditEntryList, AuditFact } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEntryListSchema, auditFactSchema } from '../../../../shared'

/** One entry to append. The Tenant is the open session's and is never a field. */
export type AuditEntryInput = AuditFact & { readonly actorUserId: string }

const entryInputSchema = z.intersection(auditFactSchema, z.object({ actorUserId: z.string().min(1) }))

/**
 * Append one entry on the caller's transaction, so it commits or rolls back
 * with the action it records. `audit.append_entry` is the only write path
 * (ADR-0014). It takes the Tenant from `app.tenant_id` and refuses when the
 * transaction has none, so the caller must have opened a tenant session.
 */
export async function appendAuditEntry(transaction: TenantTransaction, input: AuditEntryInput): Promise<void> {
  const entry = entryInputSchema.parse(input)
  await transaction.execute(sql`
    select audit.append_entry(${entry.action}, ${entry.actorUserId}, ${entry.subjectUserId}, ${JSON.stringify(entry.data)}::jsonb)
  `)
}

const entryRows = z.object({
  rows: z.array(z.object({
    id: z.string(),
    occurred_at: z.iso.datetime(),
    action: z.string(),
    actor_user_id: z.string(),
    actor_name: z.string().nullable(),
    subject_user_id: z.string().nullable(),
    subject_name: z.string().nullable(),
    data: z.unknown(),
  })),
})

/** The screen shows the latest entries only; there is no paging yet. */
const listLimit = 100

/**
 * This Tenant's newest entries. RLS limits the rows to the session's Tenant.
 * Names come from `app.tenant_member`, so someone who has left the Tenant
 * has a null name rather than one read from `auth.user`.
 * Drizzle hands timestamptz back as Postgres text, so the instant is
 * formatted as UTC ISO here rather than parsed in JavaScript.
 */
export async function listAuditEntries(transaction: TenantTransaction): Promise<AuditEntryList> {
  const { rows } = entryRows.parse(await transaction.execute(sql`
    select e.id,
           to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
           e.action, e.actor_user_id, actor.name as actor_name,
           e.subject_user_id, subject.name as subject_name, e.data
    from app.audit_entry as e
    left join app.tenant_member as actor on actor.user_id = e.actor_user_id
    left join app.tenant_member as subject on subject.user_id = e.subject_user_id
    order by e.occurred_at desc, e.id desc
    limit ${listLimit}
  `))
  return auditEntryListSchema.parse({
    entries: rows.map(row => ({
      id: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      subjectUserId: row.subject_user_id,
      subjectName: row.subject_name,
      data: row.data,
    })),
  })
}
