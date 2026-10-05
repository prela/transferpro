import type { LocationList } from '../../../../shared'
import { parseCreateLocation, parseLocationPatch } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addLocation, archiveStoredLocation, correctLocation, loadLocations, LocationArchivedError, LocationNotFoundError } from './locations'

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
