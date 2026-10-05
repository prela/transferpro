import type { DriverList } from '../../../../shared'
import { parseCreateDriver, parseDriverPatch } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addDriver, correctDriver, DriverNotFoundError, loadDriverLinkedToMember, loadDrivers } from './drivers'

export { DriverNotFoundError, loadDriverLinkedToMember, loadDrivers }

function officeOnly(role: string): void {
  // A driver sees their own Rides. Adding a Driver is office work.
  if (role === 'driver')
    throw new TenantAccessError(403)
}

/** This Tenant's Drivers. A driver is 403. Another Tenant sees none. */
export async function listDrivers(headers: Headers): Promise<DriverList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { drivers: await loadDrivers(transaction) }
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
    return addDriver(transaction, actor.userId, input)
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
    return correctDriver(transaction, actor.userId, actor.role, driverId, patch)
  })
}
