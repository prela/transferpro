import type { RecordedCreate, TransferDay } from '../../../../shared'
import { operationalDateInTimeZone, parseRecordTransfer, parseTransferDay } from '../../../../shared'
import { loadClientOfficeBriefs } from '../../clients'
import { loadPartnerOfficeContacts } from '../../partners'
import { loadTenantSettings, TenantAccessError, withOfficeWrite, withTenantFromSession } from '../../tenancy'
import { applyBoardWarnings } from './board-warnings'
import { transferFullyBooked } from './capacity-check'
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
 * The body is parsed first, so a missing entry key or an invalid guest name
 * never opens a session. The server does not assign the key.
 * A driver is 403 before the external-id lookup. A repeat returns the stored
 * Transfer with `alreadyRecorded` and writes nothing. A new one returns
 * `alreadyRecorded: false`. Both are the caller's HTTP 200.
 */
export async function createTransfer(headers: Headers, raw: unknown): Promise<RecordedCreate> {
  return withOfficeWrite(headers, raw, parseRecordTransfer, async ({ actor, transaction }, parsed) => {
    officeOnly(actor.role)
    const recorded = await recordTransfer(
      transaction,
      actor.userId,
      parsed.input,
      parsed.externalId,
      undefined,
      parsed.mainTransferId === null
        ? null
        : {
            mainTransferId: parsed.mainTransferId,
            groupPassengerCount: parsed.groupPassengerCount,
            mainVersion: parsed.mainVersion,
          },
    )
    // A repeat writes nothing, so it carries no fully booked warning.
    // A new Transfer still saves when the window is fully booked (ADR-0034).
    if (recorded.alreadyRecorded)
      return { ...recorded, fullyBooked: false }
    return {
      ...recorded,
      fullyBooked: await transferFullyBooked(transaction, {
        rideId: recorded.ride.id,
        pickupAt: new Date(recorded.transfer.pickupAt),
        landingAt: null,
        driverId: null,
        vehicleId: null,
      }),
    }
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
    const handedTo = new Set(rides.flatMap(ride => ride.partnerId === null ? [] : [ride.partnerId]))
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
      // Every Client, so the Transfer form can show a note for a Client
      // with no Ride on this day. The helper refuses a driver again.
      // ADR-0049.
      clientBriefs: await loadClientOfficeBriefs(transaction, actor.role),
      // Phone and email only for a Partner a Ride on this day is handed to.
      // A day with none skips the contact read. The note stays off this read.
      // An archived Partner is still included. The helper refuses a driver again.
      partnerBriefs: handedTo.size === 0
        ? []
        : (await loadPartnerOfficeContacts(transaction, actor.role))
            .filter(contact => handedTo.has(contact.partnerId)),
    }
  })
}
