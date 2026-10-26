import { createError } from 'h3'
import { QueryParamError, RideExportRangeError, TransferInputError } from '../../../shared'
import { ClientNotFoundError } from '../../modules/clients'
import { LocationArchivedError, LocationNotFoundError } from '../../modules/locations'
import { PartnerNotFoundError } from '../../modules/partners'
import { TenantAccessError } from '../../modules/tenancy'
import { ExtraVehicleCountError, ExtraVehiclePriceError, RideOverlapError, RideUnavailableError, StaleSaveError, TransferNotCorrectableError, TransferNotFoundError, TransferNotMainError } from '../../modules/transfers'
import { rethrowTenantChanged } from '../tenant-changed'

/**
 * Turn a Transfer failure into an HTTP error. The message stays a fixed phrase
 * for the status. A guest name is not copied from the thrown error.
 * An archived Location is the same 409 the Locations module already uses.
 * `ride_overlap` is a true overlap of the Driver or the Vehicle already
 * on the Ride. Nothing was written.
 * `stale_save` is a version the form no longer holds. Nothing was written.
 */
export function transferHttpError(error: unknown): never {
  rethrowTenantChanged(error)
  if (
    error instanceof TransferInputError
    || error instanceof QueryParamError
    || error instanceof RideExportRangeError
    || error instanceof ClientNotFoundError
    || error instanceof PartnerNotFoundError
    || error instanceof LocationNotFoundError
    || error instanceof TenantAccessError
    || error instanceof TransferNotFoundError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (
    error instanceof TransferNotCorrectableError
    || error instanceof TransferNotMainError
    || error instanceof ExtraVehiclePriceError
    || error instanceof ExtraVehicleCountError
    || error instanceof RideOverlapError
    || error instanceof RideUnavailableError
    || error instanceof StaleSaveError
  ) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  if (error instanceof LocationArchivedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
