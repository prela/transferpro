import type { RecordedTransfer, TransferDay } from '../../../../shared'
import { operationalDateInTimeZone, parseCreateTransfer, parseTransferDay } from '../../../../shared'
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
 * Rides for one operational day in the Tenant time zone. The date is the
 * calendar date of the stored start hour. A missing date is the operational
 * day that contains `now`, including when that is before the start hour.
 * `now` is the clock; tests pass a fixed instant so the default does not
 * depend on the wall clock. The date is parsed first. A driver is 403.
 * Another Tenant sees none.
 */
export async function listTransferDay(headers: Headers, rawDate: unknown, now: Date = new Date()): Promise<TransferDay> {
  const requested = parseTransferDay(rawDate)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const settings = await loadTenantSettings(transaction)
    const startHour = settings.operationalDayStartHour
    const date = requested ?? operationalDateInTimeZone(settings.timeZone, now, startHour)
    return {
      date,
      rides: await loadRidesForDay(transaction, date, settings.timeZone, startHour),
    }
  })
}
