import type { VehicleList } from '../../../../shared'
import { parseCreateVehicle, parseVehiclePatch } from '../../../../shared'
import { TenantAccessError, withTenantFromSession } from '../../tenancy'
import { addVehicle, archiveStoredVehicle, correctVehicle, loadVehicles, VehicleArchivedError, VehicleArchivedPlateError, VehicleNotFoundError, VehiclePlateTakenError } from './vehicles'

export { VehicleArchivedError, VehicleArchivedPlateError, VehicleNotFoundError, VehiclePlateTakenError }

function officeOnly(role: string): void {
  // A driver sees their own Rides. Adding a Vehicle is office work.
  if (role === 'driver')
    throw new TenantAccessError(403)
}

/** This Tenant's Vehicles. A driver is 403. Another Tenant sees none. */
export async function listVehicles(headers: Headers, includeArchived: boolean): Promise<VehicleList> {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return { vehicles: await loadVehicles(transaction, includeArchived) }
  })
}

/**
 * Add a Vehicle. The body is parsed first, so an invalid plate or date never
 * opens a session. A driver is 403. The insert and `vehicle.created` commit together.
 */
export async function createVehicle(headers: Headers, raw: unknown) {
  const input = parseCreateVehicle(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return addVehicle(transaction, actor.userId, input)
  })
}

/**
 * Correct a Vehicle. The id and the body are parsed first. A missing Vehicle
 * is 404. A patch that matches the row writes nothing.
 */
export async function updateVehicle(headers: Headers, vehicleId: string, raw: unknown) {
  const patch = parseVehiclePatch(raw)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return correctVehicle(transaction, actor.userId, vehicleId, patch)
  })
}

/**
 * Archive a Vehicle. It leaves the default list. There is no delete.
 * A second archive writes nothing.
 */
export async function archiveVehicle(headers: Headers, vehicleId: string) {
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    return archiveStoredVehicle(transaction, actor.userId, vehicleId)
  })
}
