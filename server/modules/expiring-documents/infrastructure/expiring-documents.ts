import type { ExpiringDocumentList } from '../../../../shared'
import { calendarDateInTimeZone, selectExpiringDocuments } from '../../../../shared'
import { loadDriverLinkedToMember, loadDrivers } from '../../drivers'
import { loadTenantSettings, withTenantFromSession } from '../../tenancy'
import { loadVehicles } from '../../vehicles'

/**
 * Documents that are expired or due within 30 calendar days.
 * The day is today in the Tenant time zone. Nothing is stored and nothing
 * is written: the dates already live on Drivers and Vehicles.
 * A driver is limited to the Driver linked to their account. The query
 * asks only for that member, and vehicle rows are not read.
 * An unlinked driver gets an empty list, not an error.
 */
export async function listExpiringDocuments(headers: Headers, now: Date = new Date()): Promise<ExpiringDocumentList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    const settings = await loadTenantSettings(transaction)
    const today = calendarDateInTimeZone(settings.timeZone, now)
    const drivers = actor.role === 'driver'
      ? await loadDriverLinkedToMember(transaction, actor.userId)
      : await loadDrivers(transaction)
    const vehicles = actor.role === 'driver'
      ? []
      : await loadVehicles(transaction, false)
    return {
      documents: selectExpiringDocuments({
        role: actor.role,
        userId: actor.userId,
        today,
        drivers,
        vehicles,
      }),
    }
  })
}
