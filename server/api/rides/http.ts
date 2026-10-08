import { createError } from 'h3'
import { AssignRideInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { AcceptRideInputError, RideNotAcceptableError, RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError } from '../../modules/transfers'

/**
 * Turn an assignment or accept failure into an HTTP error. The message stays
 * a fixed phrase for the status. A plate or a phone is not copied from the
 * thrown error. `ride_vehicle_archived` is `ride.vehicleArchived`.
 * `ride_not_unassigned` is `ride.notUnassigned`. `ride_not_acceptable` is the
 * accept conflict: the flag is off, or the Ride is not `assigned`.
 */
export function rideHttpError(error: unknown): never {
  if (
    error instanceof AssignRideInputError
    || error instanceof AcceptRideInputError
    || error instanceof RideNotFoundError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (
    error instanceof RideVehicleArchivedError
    || error instanceof RideNotUnassignedError
    || error instanceof RideNotAcceptableError
  ) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
