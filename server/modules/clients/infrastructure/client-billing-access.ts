import type { ClientBilling } from '../../../../shared'
import { parseClientBillingSave } from '../../../../shared'
import { TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { loadClientBillingDetails, saveClientBilling } from './client-billing'

function officeOnly(role: string): void {
  // A driver does not keep the Client card. Billing details are office work.
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
}

/**
 * This Client's billing details. The role is checked here, not by the route's
 * caller. A driver is 403. Another Tenant's Client is 404. No row is incomplete.
 */
export async function readClientBilling(headers: Headers, clientId: string): Promise<ClientBilling> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return loadClientBillingDetails(transaction, clientId, actor.role)
  })
}

/**
 * Save this Client's billing details. The body is parsed first, so a bad
 * value never opens a session. The first save sends no version. A stale
 * version is 409 `stale_save`.
 */
export async function writeClientBilling(headers: Headers, clientId: string, raw: unknown) {
  return withOfficeWrite(headers, raw, parseClientBillingSave, async ({ actor, transaction }, input) => {
    officeOnly(actor.role)
    return saveClientBilling(transaction, actor.userId, clientId, input)
  })
}
