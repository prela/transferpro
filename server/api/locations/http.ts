import { createError } from 'h3'
import { z } from 'zod'
import { LocationInputError, parseIncludeArchivedQuery, QueryParamError } from '../../../shared'
import { LocationArchivedError, LocationNotFoundError } from '../../modules/locations'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Location failure into an HTTP error. The message stays a fixed phrase
 * for the status. An address is not copied from the thrown error.
 */
export function locationHttpError(error: unknown): never {
  if (error instanceof LocationInputError || error instanceof LocationNotFoundError || error instanceof TenantAccessError) {
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

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseLocationId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}

/** Default list hides archived Locations. Only the string true includes them. */
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
