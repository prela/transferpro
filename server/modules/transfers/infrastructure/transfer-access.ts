import type { RecordedTransfer, TransferDay } from '../../../../shared'
import { calendarDateInTimeZone, parseCreateTransfer, parseTransferDay } from '../../../../shared'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { loadRidesForDay, recordTransfer } from './transfers'

function officeOnly(role: string): void {
  // Recording a Transfer and reading the day list are office work.
  // A driver, and any other role, is refused before a Location is loaded.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/**
 * Record a Transfer and its one unassigned Ride.
 * The body is parsed first, so an invalid guest name never opens a session.
 * A driver is 403. The inserts and `transfer.created` commit together.
 * `loadLocation` does not check the role, so the allow-list runs first.
 */
export async function createTransfer(headers: Headers, raw: unknown): Promise<RecordedTransfer> {
  const input = parseCreateTransfer(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return recordTransfer(transaction, actor.userId, input)
  })
}

/**
 * Rides for one calendar day in the Tenant time zone. A missing date is today.
 * The date is parsed first. A driver is 403. Another Tenant sees none.
 */
export async function listTransferDay(headers: Headers, rawDate: unknown): Promise<TransferDay> {
  const requested = parseTransferDay(rawDate)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const settings = await loadTenantSettings(transaction)
    const date = requested ?? calendarDateInTimeZone(settings.timeZone, new Date())
    return {
      date,
      rides: await loadRidesForDay(transaction, date, settings.timeZone),
    }
  })
}
