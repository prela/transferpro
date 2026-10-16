import type { DriverList } from '../../../../shared'
import { parseCreateDriver, parseDriverPatch } from '../../../../shared'
import { readSignInEmail, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addDriver, archiveStoredDriver, correctDriver, DriverArchivedError, DriverNotFoundError, loadDriverLinkedToMember, loadDrivers, unarchiveStoredDriver } from './drivers'

export { DriverArchivedError, DriverNotFoundError, loadDriverLinkedToMember, loadDrivers }

function officeOnly(role: string): void {
  // A driver sees their own Rides. Adding a Driver is office work.
  if (role === 'driver')
    throw new TenantAccessError(403)
}

/** This Tenant's Drivers. A driver is 403. Another Tenant sees none. Archived rows stay out unless asked for. */
export async function listDrivers(headers: Headers, includeArchived: boolean): Promise<DriverList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { drivers: await loadDrivers(transaction, includeArchived) }
  })
}

/**
 * Add a Driver. The body is parsed first, so an invalid phone or date never
 * opens a session. A driver is 403. The insert and `driver.created` commit together.
 */
export async function createDriver(headers: Headers, raw: unknown) {
  const input = parseCreateDriver(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return addDriver(transaction, actor.userId, input, readSignInEmail)
  })
}

/**
 * Correct a Driver. The id and the body are parsed first. A missing Driver
 * is 404. A patch that matches the row writes nothing. Only an admin may
 * change must-accept; that check runs after the row is locked.
 */
export async function updateDriver(headers: Headers, driverId: string, raw: unknown) {
  const patch = parseDriverPatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return correctDriver(transaction, actor.userId, actor.role, driverId, patch, readSignInEmail)
  })
}

/**
 * Archive a Driver. It leaves the default list and cannot be newly assigned.
 * There is no delete. A second archive writes nothing.
 */
export async function archiveDriver(headers: Headers, driverId: string) {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return archiveStoredDriver(transaction, actor.userId, driverId)
  })
}

/**
 * Put an archived Driver back on the default list. A Driver who is already
 * there writes nothing.
 */
export async function unarchiveDriver(headers: Headers, driverId: string) {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return unarchiveStoredDriver(transaction, actor.userId, driverId)
  })
}
