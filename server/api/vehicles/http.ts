import { createError } from 'h3'
import { z } from 'zod'
import { parseIncludeArchivedQuery, QueryParamError, VehicleInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { VehicleArchivedError, VehicleArchivedPlateError, VehicleNotFoundError, VehiclePlateTakenError } from '../../modules/vehicles'

/**
 * Turn a Vehicle failure into an HTTP error. The message stays a fixed phrase
 * for the status. A plate is not copied from the thrown error.
 */
export function vehicleHttpError(error: unknown): never {
  if (error instanceof VehicleInputError || error instanceof VehicleNotFoundError || error instanceof TenantAccessError) {
    throw createError({ statusCode: error.statusCode })
  }
  if (error instanceof VehiclePlateTakenError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  if (error instanceof VehicleArchivedError || error instanceof VehicleArchivedPlateError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseVehicleId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}

/** Default list hides archived Vehicles. Only the string true includes them. */
export function parseIncludeArchived(raw: unknown): boolean {
  try {
    return parseIncludeArchivedQuery(raw)
  }
  catch (error) {
    if (error instanceof QueryParamError)
      throw createError({ statusCode: 400 })
    throw error
  }
}
