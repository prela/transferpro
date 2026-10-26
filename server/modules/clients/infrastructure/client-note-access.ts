import type { ClientNote } from '../../../../shared'
import { parseClientNoteSave } from '../../../../shared'
import { TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { loadClientNote, saveClientNote } from './client-notes'

function officeOnly(role: string): void {
  // A driver does not keep the Client card. The note is office work.
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
}

/**
 * This Client's standing note. The role is checked here, not by the route's
 * caller. A driver is 403. Another Tenant's Client is 404. No row is an
 * empty note.
 */
export async function readClientNote(headers: Headers, clientId: string): Promise<ClientNote> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return loadClientNote(transaction, clientId)
  })
}

/**
 * Save this Client's note. The body is parsed first, so a bad note never
 * opens a session. The first save sends no version. A stale version is
 * 409 `stale_save`.
 */
export async function writeClientNote(headers: Headers, clientId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parseClientNoteSave, async ({ actor, transaction }, input) => {
    officeOnly(actor.role)
    return saveClientNote(transaction, actor.userId, clientId, input)
  })
}
