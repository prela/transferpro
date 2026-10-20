import type { RecordedCreate, TransferDay } from '../../../../shared'
import { operationalDateInTimeZone, parseRecordTransfer, parseTransferDay } from '../../../../shared'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { applyBoardWarnings } from './board-warnings'
import { loadDeclineAlertsForDay, loadRidesForDay, recordTransfer } from './transfers'

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
 * A driver is 403 before the external-id lookup. A repeat returns the stored
 * Transfer with `alreadyRecorded` and writes nothing. A new one returns
 * `alreadyRecorded: false`. Both are the caller's HTTP 200.
 */
export async function createTransfer(headers: Headers, raw: unknown): Promise<RecordedCreate> {
  const { input, externalId } = parseRecordTransfer(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return recordTransfer(transaction, actor.userId, input, externalId)
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
    const rides = await loadRidesForDay(
      transaction,
      date,
      settings.timeZone,
      startHour,
      now,
      settings.transferDurationMinutes,
    )
    return {
      date,
      rides: await applyBoardWarnings(
        transaction,
        actor.role,
        rides,
        settings.timeZone,
        date,
        startHour,
        settings.transferDurationMinutes,
        settings.relocationGapMinutes,
      ),
      declineAlerts: await loadDeclineAlertsForDay(
        transaction,
        date,
        settings.timeZone,
        startHour,
      ),
    }
  })
}
