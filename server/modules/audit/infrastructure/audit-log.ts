import type { AuditEntryList, AuditFact } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEntrySchema, auditFactSchema } from '../../../../shared'

/** One entry to append. The Tenant is the open session's and is never a field. */
export type AuditEntryInput = AuditFact & { readonly actorUserId: string }

const entryInputSchema = z.intersection(auditFactSchema, z.object({ actorUserId: z.string().min(1) }))

/**
 * Append one entry on the caller's transaction, so it commits or rolls back
 * with the action it records. Application code writes only through
 * `audit.append_entry` (ADR-0014). It takes the Tenant from `app.tenant_id`
 * and refuses when the transaction has none, so the caller must have opened
 * a tenant session.
 */
export async function appendAuditEntry(transaction: TenantTransaction, input: AuditEntryInput): Promise<void> {
  const entry = entryInputSchema.parse(input)
  await transaction.execute(sql`
    select audit.append_entry(${entry.action}, ${entry.actorUserId}, ${entry.subjectUserId}, ${JSON.stringify(entry.data)}::jsonb)
  `)
}

const entryRows = z.object({ rows: z.array(auditEntrySchema) })

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
           to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt",
           e.action,
           e.actor_user_id as "actorUserId",
           actor.name as "actorName",
           e.subject_user_id as "subjectUserId",
           subject.name as "subjectName",
           e.data
    from app.audit_entry as e
    left join app.tenant_member as actor on actor.user_id = e.actor_user_id
    left join app.tenant_member as subject on subject.user_id = e.subject_user_id
    order by e.occurred_at desc, e.id desc
    limit ${listLimit}
  `))
  return { entries: rows }
}
