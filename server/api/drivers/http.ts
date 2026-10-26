import { createError } from 'h3'
import { z } from 'zod'
import { DriverInputError, parseIncludeArchivedQuery, QueryParamError } from '../../../shared'
import { DriverArchivedError, DriverNotFoundError } from '../../modules/drivers'
import { TenantAccessError } from '../../modules/tenancy'
import { rethrowTenantChanged } from '../tenant-changed'

/**
 * Turn a Driver failure into an HTTP error. The message stays a fixed phrase
 * for the status. A phone number is not copied from the thrown error.
 */
export function driverHttpError(error: unknown): never {
  rethrowTenantChanged(error)
  if (error instanceof DriverInputError || error instanceof DriverNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof DriverArchivedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseDriverId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}

/** Default list hides archived Drivers. Only the string true includes them. */
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
