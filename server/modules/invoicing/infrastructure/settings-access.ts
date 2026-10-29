import type { InvoicingSettings } from '../../../../shared'
import { parseInvoicingSettingsSave } from '../../../../shared'
import { readInvoicingSecretKey } from '../../../core'
import { TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { changeInvoicingSettings, loadInvoicingSettings } from './settings'

function adminOnly(role: string): void {
  // A dispatcher and a driver do not keep the current tool's token (ADR-0051).
  if (role !== 'admin')
    throw new TenantAccessError(403)
}

/**
 * This Tenant's invoicing settings. The role is checked here, not by the
 * route's caller. A dispatcher or a driver is 403. The token is not in the
 * view: only whether it is set, and its last four characters.
 */
export async function readInvoicingSettings(headers: Headers): Promise<InvoicingSettings> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    adminOnly(actor.role)
    return loadInvoicingSettings(transaction)
  })
}

/**
 * Save this Tenant's invoicing settings. The body is parsed first, so a bad
 * value never opens a session. A stale version is 409 `stale_save`.
 */
export async function writeInvoicingSettings(headers: Headers, raw: unknown) {
  return withOfficeWrite(headers, raw, parseInvoicingSettingsSave, async ({ actor, transaction, context }, input) => {
    adminOnly(actor.role)
    return changeInvoicingSettings(transaction, actor.userId, context.tenantId, input, readInvoicingSecretKey())
  })
}
