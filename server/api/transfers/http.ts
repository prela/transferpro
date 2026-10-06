import { createError } from 'h3'
import { QueryParamError, TransferInputError } from '../../../shared'
import { ClientNotFoundError } from '../../modules/clients'
import { LocationArchivedError, LocationNotFoundError } from '../../modules/locations'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Transfer failure into an HTTP error. The message stays a fixed phrase
 * for the status. A guest name is not copied from the thrown error.
 * An archived Location is the same 409 the Locations module already uses.
 */
export function transferHttpError(error: unknown): never {
  if (
    error instanceof TransferInputError
    || error instanceof QueryParamError
    || error instanceof ClientNotFoundError
    || error instanceof LocationNotFoundError
    || error instanceof TenantAccessError
  ) {
    throw createError({ statusCode: error.statusCode })
  }
  if (error instanceof LocationArchivedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
