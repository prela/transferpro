import { createError } from 'h3'
import { AssignRideInputError, RideCommandInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { AcceptRideInputError, MarkRideDoneInputError, RideNotAcceptableError, RideNotFinishableError, RideNotFoundError, RideNotOpenError, RideNotUnassignedError, RideOverlapError, RideSameDriverError, RideVehicleArchivedError, RideVehicleUnchangedError } from '../../modules/transfers'

/**
 * Turn an assignment or accept failure into an HTTP error. The message stays
 * a fixed phrase for the status. A plate or a phone is not copied from the
 * thrown error. `ride_vehicle_archived` is `ride.vehicleArchived`.
 * `ride_not_unassigned` is `ride.notUnassigned`. `ride_not_acceptable` is the
 * accept conflict: the flag is off, or the Ride is not `assigned`.
 * `ride_not_open` is a vehicle change, a clear, or a reassignment on a Ride
 * that is not `assigned` or `accepted`. `ride_vehicle_unchanged` is the same
 * Vehicle. `ride_same_driver` is a reassignment to the Driver already on the Ride.
 * `ride_overlap` is a true overlap of the Driver or the Vehicle.
 * `ride_not_finishable` is done refused: the copied flag and the state do
 * not allow it, or a concurrent command already won. Nothing was written.
 */
export function rideHttpError(error: unknown): never {
  if (
    error instanceof AssignRideInputError
    || error instanceof RideCommandInputError
    || error instanceof AcceptRideInputError
    || error instanceof MarkRideDoneInputError
    || error instanceof RideNotFoundError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (
    error instanceof RideVehicleArchivedError
    || error instanceof RideNotUnassignedError
    || error instanceof RideNotAcceptableError
    || error instanceof RideNotFinishableError
    || error instanceof RideNotOpenError
    || error instanceof RideVehicleUnchangedError
    || error instanceof RideSameDriverError
    || error instanceof RideOverlapError
  ) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
