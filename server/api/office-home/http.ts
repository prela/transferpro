import { createError } from 'h3'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn an office-home failure into an HTTP error. The message stays a fixed
 * phrase. A guest name, a flight number, or a price is not copied from the
 * thrown error.
 */
export function officeHomeHttpError(error: unknown): never {
  if (error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw createError({ statusCode: 500 })
}
