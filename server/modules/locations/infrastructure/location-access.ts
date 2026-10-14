import type { LocationList } from '../../../../shared'
import { parseCreateLocation, parseLocationPatch, parseSuggestAddresses, suggestAddressesResponseSchema } from '../../../../shared'
import { loadAppEnv } from '../../../core/index'
import { loadTenantDefaultLocale, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addLocation, archiveStoredLocation, correctLocation, loadLocations, LocationArchivedError, LocationNotFoundError } from './locations'
import { mapsForApp } from './maps'

export { LocationArchivedError, LocationNotFoundError }

function officeOnly(role: string): void {
  // Adding a Location is office work. A driver, and any other role, is refused.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/** This Tenant's Locations. A driver is 403. Another Tenant sees none. */
export async function listLocations(headers: Headers, includeArchived: boolean): Promise<LocationList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { locations: await loadLocations(transaction, includeArchived) }
  })
}

/**
 * Add a Location. The body is parsed first, so an invalid name or kind never
 * opens a session. A driver is 403. The insert and `location.created` commit together.
 */
export async function createLocation(headers: Headers, raw: unknown) {
  const input = parseCreateLocation(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return addLocation(transaction, actor.userId, input)
  })
}

/**
 * Correct a Location. The id and the body are parsed first. A missing Location
 * is 404. A patch that matches the row writes nothing.
 */
export async function updateLocation(headers: Headers, locationId: string, raw: unknown) {
  const patch = parseLocationPatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return correctLocation(transaction, actor.userId, locationId, patch)
  })
}

/**
 * Archive a Location. It leaves the default list. There is no delete.
 * A second archive writes nothing.
 */
export async function archiveLocation(headers: Headers, locationId: string) {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return archiveStoredLocation(transaction, actor.userId, locationId)
  })
}

const unavailable = { available: false as const, suggestions: [], attribution: null }

/**
 * Address suggestions for the office. The body is parsed first. A driver is
 * 403. A lookup is not a state change, so nothing is audited and the body
 * is not logged. An adapter failure is "unavailable", and saving still works.
 */
export async function suggestAddresses(headers: Headers, raw: unknown) {
  const input = parseSuggestAddresses(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const language = await loadTenantDefaultLocale(transaction)
    try {
      const result = await mapsForApp(loadAppEnv()).suggestAddresses({
        text: input.text,
        sessionToken: input.sessionToken,
        language,
      })
      if (!result.available)
        return unavailable
      return suggestAddressesResponseSchema.parse({
        available: true,
        suggestions: result.suggestions,
        attribution: result.attribution,
      })
    }
    catch {
      return unavailable
    }
  })
}
