import type { RosterDay, SetRosterResult } from '../../../../shared'
import { parseRosterDate, parseSetRoster } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadRosterDay, setRosterVehicle } from './roster'

function officeOnly(role: string): void {
  // The day's list is an office screen. A driver does not edit it and does not read every row.
  if (role === 'driver')
    throw new TenantAccessError(403)
}

/**
 * This Tenant's roster for one calendar date. The date is parsed first, so a
 * bad query never opens a session. A driver is 403. Another Tenant sees none.
 */
export async function listRosterDay(headers: Headers, rawDate: unknown): Promise<RosterDay> {
  const rosterDate = parseRosterDate(rawDate)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { rosterDate, assignments: await loadRosterDay(transaction, rosterDate) }
  })
}

/**
 * Set or clear one Driver's Vehicle for one day. The body is parsed first.
 * The write and its audit entry commit together. A driver is 403.
 */
export async function setRosterDay(headers: Headers, raw: unknown): Promise<SetRosterResult> {
  const input = parseSetRoster(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { assignment: await setRosterVehicle(transaction, actor.userId, input) }
  })
}
