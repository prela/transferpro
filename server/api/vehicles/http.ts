import { createError } from 'h3'
import { z } from 'zod'
import { parseIncludeArchivedQuery, VehicleInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { VehicleConflictError, VehicleNotFoundError } from '../../modules/vehicles'

/**
 * Turn a Vehicle failure into an HTTP error. The message stays a fixed phrase
 * for the status. A plate is not copied from the thrown error.
 */
export function vehicleHttpError(error: unknown): never {
  if (
    error instanceof VehicleInputError
    || error instanceof VehicleNotFoundError
    || error instanceof VehicleConflictError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
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
    if (error instanceof VehicleInputError)
      throw createError({ statusCode: 400 })
    throw error
  }
}
