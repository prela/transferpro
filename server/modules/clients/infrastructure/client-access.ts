import type { ClientList } from '../../../../shared'
import { parseClientPatch, parseCreateClient } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addClient, ClientNotFoundError, correctClient, loadClientList } from './clients'

export { ClientNotFoundError }

function officeOnly(role: string): void {
  // A driver waits out a No-show. Adding a Client is office work.
  if (role === 'driver')
    throw new TenantAccessError(403)
}

/**
 * This Tenant's Clients, each with its version and last author. A driver is
 * 403. Another Tenant sees none, and never sees this Tenant's author.
 */
export async function listClients(headers: Headers): Promise<ClientList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { clients: await loadClientList(transaction) }
  })
}

/**
 * Add a Client. The body is parsed first, so an invalid name or kind never
 * opens a session. A driver is 403. The insert and `client.created` commit together.
 */
export async function createClient(headers: Headers, raw: unknown) {
  const input = parseCreateClient(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return addClient(transaction, actor.userId, input)
  })
}

/**
 * Correct a Client. The id and the body are parsed first, so a missing
 * version is 400 before a session opens. A missing Client is 404. A stale
 * version is 409 `stale_save`. A patch that matches the row writes nothing.
 */
export async function updateClient(headers: Headers, clientId: string, raw: unknown) {
  const patch = parseClientPatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return correctClient(transaction, actor.userId, clientId, patch)
  })
}
