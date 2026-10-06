import { createError } from 'h3'
import { AssignRideInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError } from '../../modules/transfers'

/**
 * Turn an assignment failure into an HTTP error. The message stays a fixed
 * phrase for the status. A plate or a phone is not copied from the thrown error.
 * `ride_vehicle_archived` is `ride.vehicleArchived`. `ride_not_unassigned` is
 * `ride.notUnassigned`.
 */
export function rideHttpError(error: unknown): never {
  if (
    error instanceof AssignRideInputError
    || error instanceof RideNotFoundError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (error instanceof RideVehicleArchivedError || error instanceof RideNotUnassignedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
