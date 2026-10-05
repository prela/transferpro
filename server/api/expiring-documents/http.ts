import { createError } from 'h3'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a session failure into an HTTP error. The message stays a fixed phrase
 * for the status. Names, plates, and dates are not copied from the error.
 */
export function expiringDocumentsHttpError(error: unknown): never {
  if (error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}
