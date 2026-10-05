import type pg from 'pg'
import { z } from 'zod'
import { auditFactSchema } from '../../../../shared'

/**
 * Same check as appendAuditEntry (ADR-0014): Zod, then the table check.
 * These connections are not a tenant transaction, so they cannot call
 * appendAuditEntry. ADR-0019 has them execute audit.append_entry themselves.
 */
const platformAuditSchema = z.intersection(
  auditFactSchema,
  z.object({ actorUserId: z.string().min(1) }),
)

export async function appendPlatformAudit(
  client: pg.PoolClient,
  input: { action: 'tenant.renamed' | 'tenant.suspended' | 'tenant.reactivated', actorUserId: string },
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
