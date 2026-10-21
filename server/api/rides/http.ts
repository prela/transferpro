import { createError } from 'h3'
import { AssignRideInputError, RideCommandInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { AcceptRideInputError, CancelRideInputError, DeclineRideInputError, MarkNoShowInputError, MarkRideDoneInputError, NoShowTooEarlyError, RecordLandingInputError, RideDriverArchivedError, RideLandingClosedError, RideLandingInFutureError, RideNotAcceptableError, RideNotCancellableError, RideNotDeclinableError, RideNotFinishableError, RideNotFoundError, RideNotHandedOffError, RideNotHandoffableError, RideNotNoShowError, RideNotOpenError, RideNotUnassignedError, RideOverlapError, RidePartnerArchivedError, RidePartnerUnchangedError, RideSameDriverError, RideUnavailableError, RideVehicleArchivedError, RideVehicleUnchangedError, StaleSaveError } from '../../modules/transfers'

/**
 * Turn an assignment or accept failure into an HTTP error. The message stays
 * a fixed phrase for the status. A plate or a phone is not copied from the
 * thrown error. `ride_driver_archived` is `ride.driverArchived`.
 * `ride_vehicle_archived` is `ride.vehicleArchived`.
 * `ride_not_unassigned` is `ride.notUnassigned`. `ride_not_acceptable` is the
 * accept conflict: the flag is off, or the Ride is not `assigned`.
 * `ride_not_open` is a vehicle change, a clear, or a reassignment on a Ride
 * that is not `assigned` or `accepted`. `ride_vehicle_unchanged` is the same
 * Vehicle. `ride_same_driver` is a reassignment to the Driver already on the Ride.
 * `ride_overlap` is a true overlap of the Driver or the Vehicle.
 * `ride_unavailable` is an unavailability window over the Driver or the
 * Vehicle (ADR-0034). `confirm: true` passes both.
 * `ride_not_finishable` is done refused: the copied flag and the state do
 * not allow it, or a concurrent command already won. Nothing was written.
 * `ride_not_no_show` is a No-show refused: the copied flag and the state do
 * not allow it, or a concurrent command already won. Nothing was written.
 * `no_show_too_early` is a Driver No-show before the wait. The Ride stays.
 * `ride_not_cancellable` is a cancel from `done`, `no-show`, or `cancelled`,
 * or a concurrent command already won. Nothing was written.
 * `ride_not_declinable` is a decline refused: the Ride is not `assigned`,
 * or a concurrent command already won. Nothing was written.
 * `landing_time_closed` is a landing time on `done`, `no-show`, or
 * `cancelled`. The stored time stays. `landing_time_in_future` is an instant
 * still ahead of now. Nothing was written.
 * `stale_save` is a version the form no longer holds. Nothing was written.
 * `ride_not_handoffable` is a handoff from a state other than `unassigned`,
 * `assigned`, or `accepted`. `ride_not_handed_off` is a Partner change or a
 * take-back when the Ride is not `handed_off`. `ride_partner_archived` is an
 * archived Partner. `ride_partner_unchanged` is the Partner already on the
 * Ride. Each of those writes nothing.
 */
export function rideHttpError(error: unknown): never {
  if (
    error instanceof AssignRideInputError
    || error instanceof RideCommandInputError
    || error instanceof AcceptRideInputError
    || error instanceof MarkRideDoneInputError
    || error instanceof MarkNoShowInputError
    || error instanceof CancelRideInputError
    || error instanceof DeclineRideInputError
    || error instanceof RecordLandingInputError
    || error instanceof RideNotFoundError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (
    error instanceof RideDriverArchivedError
    || error instanceof RideVehicleArchivedError
    || error instanceof RideNotUnassignedError
    || error instanceof RideNotAcceptableError
    || error instanceof RideNotFinishableError
    || error instanceof RideNotNoShowError
    || error instanceof NoShowTooEarlyError
    || error instanceof RideNotCancellableError
    || error instanceof RideNotDeclinableError
    || error instanceof RideLandingClosedError
    || error instanceof RideLandingInFutureError
    || error instanceof RideNotOpenError
    || error instanceof RideVehicleUnchangedError
    || error instanceof RideSameDriverError
    || error instanceof RideOverlapError
    || error instanceof RideUnavailableError
    || error instanceof StaleSaveError
    || error instanceof RideNotHandoffableError
    || error instanceof RideNotHandedOffError
    || error instanceof RidePartnerArchivedError
    || error instanceof RidePartnerUnchangedError
  ) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
