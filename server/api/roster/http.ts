import { createError } from 'h3'
import { RosterInputError } from '../../../shared'
import { RosterDriverTakenError, RosterNotFoundError, RosterVehicleArchivedError, RosterVehicleTakenError } from '../../modules/roster'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a roster failure into an HTTP error. The message stays a fixed phrase
 * for the status. A plate, a name, or a phone is not copied from the thrown error.
 */
export function rosterHttpError(error: unknown): never {
  if (error instanceof RosterInputError || error instanceof RosterNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof RosterVehicleTakenError || error instanceof RosterVehicleArchivedError || error instanceof RosterDriverTakenError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
