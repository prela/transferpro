import type { Location, OfficeLocation, OfficeLocationList } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { officeLocationSchema, parseCreateLocation, parseLocationPatch, parseSuggestAddresses, resolveDisplayLocale, suggestAddressesResponseSchema } from '../../../../shared'
import { loadAppEnv } from '../../../core/index'
import { loadTenantDefaultLocale, readUserLocale, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addLocation, archiveStoredLocation, correctLocation, loadLocations, LocationArchivedError, LocationIataTakenError, LocationNotFoundError } from './locations'
import { mapsForApp } from './maps'

export { LocationArchivedError, LocationIataTakenError, LocationNotFoundError }

function officeOnly(role: string): void {
  // Adding a Location is office work. A driver, and any other role, is refused.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

/** This Tenant's Locations. A driver is 403. Another Tenant sees none. */
export async function listLocations(headers: Headers, includeArchived: boolean): Promise<OfficeLocationList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    const locations = await loadLocations(transaction, includeArchived)
    return { locations: await withEmbedUrls(transaction, actor.userId, locations) }
  })
}

/**
 * Add a Location. The body is parsed first, so an invalid name or kind never
 * opens a session. A driver is 403. The insert and `location.created` commit together.
 */
export async function createLocation(headers: Headers, raw: unknown): Promise<OfficeLocation> {
  const input = parseCreateLocation(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return withEmbedUrl(transaction, actor.userId, await addLocation(transaction, actor.userId, input))
  })
}

/**
 * Correct a Location. The id and the body are parsed first. A missing Location
 * is 404. A patch that matches the row writes nothing.
 */
export async function updateLocation(headers: Headers, locationId: string, raw: unknown): Promise<OfficeLocation> {
  const patch = parseLocationPatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return withEmbedUrl(transaction, actor.userId, await correctLocation(transaction, actor.userId, locationId, patch))
  })
}

/**
 * Archive a Location. It leaves the default list. There is no delete.
 * A second archive writes nothing.
 */
export async function archiveLocation(headers: Headers, locationId: string): Promise<OfficeLocation> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return withEmbedUrl(transaction, actor.userId, await archiveStoredLocation(transaction, actor.userId, locationId))
  })
}

/**
 * The member's chosen locale, otherwise the Tenant default (ADR-0011).
 * The Embed language follows the viewer, not the stored address language.
 */
async function viewerLanguage(transaction: TenantTransaction, userId: string): Promise<string> {
  return resolveDisplayLocale(
    await readUserLocale(userId),
    await loadTenantDefaultLocale(transaction),
  )
}

/**
 * Attach the Embed URL for this read. A failure here must not repeat the
 * URL: it carries the Embed key once the Google adapter is in use.
 */
async function withEmbedUrl(transaction: TenantTransaction, userId: string, location: Location): Promise<OfficeLocation> {
  const [office] = await withEmbedUrls(transaction, userId, [location])
  if (!office)
    throw new Error('Location read failed')
  return office
}

async function withEmbedUrls(transaction: TenantTransaction, userId: string, locations: readonly Location[]): Promise<OfficeLocation[]> {
  const language = await viewerLanguage(transaction, userId)
  const maps = mapsForApp(loadAppEnv())
  return locations.map((location) => {
    const parsed = officeLocationSchema.safeParse({
      ...location,
      embedUrl: maps.embedUrl(location, language),
    })
    if (!parsed.success)
      throw new Error('Location read failed')
    return parsed.data
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
