import type pg from 'pg'
import { z } from 'zod'
import { auditFactSchema } from '../../../../shared'

/**
 * Same check as appendAuditEntry (ADR-0014): Zod, then the table check.
 * These connections are not a tenant transaction, so they cannot call
 * appendAuditEntry. The operator lever runs as transferpro_owner and executes
 * audit.append_entry. Rename does not: the platform role has no execute on
 * that function (ADR-0019).
 */
const platformAuditSchema = z.intersection(
  auditFactSchema,
  z.object({ actorUserId: z.string().min(1) }),
)

/** The platform role's only audit write. Action and data are fixed in the database. */
export async function appendTenantRenamed(client: pg.PoolClient, actorUserId: string): Promise<void> {
  const actor = z.string().min(1).parse(actorUserId)
  await client.query('select audit.append_tenant_renamed($1)', [actor])
}

export async function appendPlatformAudit(
  client: pg.PoolClient,
  input: { action: 'tenant.suspended' | 'tenant.reactivated', actorUserId: string },
): Promise<void> {
  const entry = platformAuditSchema.parse({
    action: input.action,
    actorUserId: input.actorUserId,
    subjectUserId: null,
    data: {},
  })
  await client.query(
    'select audit.append_entry($1, $2, $3, $4::jsonb)',
    [entry.action, entry.actorUserId, entry.subjectUserId, JSON.stringify(entry.data)],
  )
}
