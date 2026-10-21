import type { TenantContext, TenantTransaction } from '../../../core/index'
import type { InvitationForMail } from '../../tenancy'
import type { LoadedInvitationEntry, OutboxAttemptStore } from '../application/attempt'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'
import { invitationEmail, readInvitationForMail } from '../../tenancy'
import { saveOutboxAttempt } from './outbox'

const invitationRows = z.object({
  rows: z.array(z.object({
    invitationId: z.uuid(),
    state: z.enum(['pending', 'sent', 'failed', 'stale']),
    attemptCount: z.number().int(),
    nextAttemptAt: z.unknown(),
    locale: z.enum(['hr', 'en']),
  })),
})

/** Better Auth's row for this Tenant, read on the auth pool. Injected by tests. */
export type InvitationReader = (tenantId: string, invitationId: string) => Promise<InvitationForMail | null>

/**
 * The invitation entry as an attempt has to see it, locked on this
 * transaction. The mail is composed from the invitation (email, role), the
 * Tenant name, and the Tenant default locale, as `invitationEmail` does.
 * An invitation this Tenant does not have is null facts, so it is stale.
 * A reader failure is not a decision: it propagates and nothing is counted.
 * No role check: the worker has no actor. HTTP use is the worker-used loader list (#344).
 */
export async function loadInvitationAttempt(
  transaction: TenantTransaction,
  context: TenantContext,
  entryId: string,
  read: InvitationReader = readInvitationForMail,
): Promise<LoadedInvitationEntry | null> {
  const id = z.uuid().parse(entryId)
  const row = await hideDatabaseError(async () => {
    const parsed = invitationRows.parse(await transaction.execute(sql`
      select
        o.invitation_id as "invitationId",
        o.state,
        o.attempt_count as "attemptCount",
        o.next_attempt_at as "nextAttemptAt",
        s.default_locale as "locale"
      from app.mail_outbox as o
      join app.tenant_settings as s
        on s.tenant_id = o.tenant_id
      where o.id = ${id}
        and o.kind = 'invitation'
      for update of o
    `))
    return parsed.rows[0] ?? null
  }, 'Mail outbox read failed')
  if (!row)
    return null
  let invitation: InvitationForMail | null
  try {
    invitation = await read(context.tenantId, row.invitationId)
  }
  catch {
    // The auth pool message can name the id. Keep a fixed phrase.
    throw new Error('Mail outbox read failed')
  }
  const mail = invitation?.mail ? { ...invitation.mail, locale: row.locale } : null
  return {
    kind: 'invitation',
    entryId: id,
    state: row.state,
    attemptCount: row.attemptCount,
    nextAttemptAt: toOptionalInstant(row.nextAttemptAt),
    invitation: invitation ? { status: invitation.status, expiresAt: invitation.expiresAt } : null,
    mail,
    message: mail ? invitationEmail(mail) : null,
  }
}

/** Store for invitation entries, bound to one tenant transaction. No role check (#344). */
export function invitationAttemptStore(
  transaction: TenantTransaction,
  context: TenantContext,
  read?: InvitationReader,
): OutboxAttemptStore {
  return {
    load: entryId => loadInvitationAttempt(transaction, context, entryId, read),
    save: (entryId, patch) => saveOutboxAttempt(transaction, entryId, patch),
  }
}

function toOptionalInstant(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(parsed.getTime()))
    throw new Error('Mail outbox read failed')
  return parsed
}
