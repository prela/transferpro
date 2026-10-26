import { createError } from 'h3'
import { TenantAccessError } from '../../modules/tenancy'
import { FailedMailInputError, FailedMailNotFoundError } from '../../modules/transfers'
import { rethrowTenantChanged } from '../tenant-changed'

/**
 * Turn an office-home failure into an HTTP error. The message stays a fixed
 * phrase. A guest name, a flight number, or a price is not copied from the
 * thrown error.
 */
export function officeHomeHttpError(error: unknown): never {
  // A stale screen is 409, not a 500 from the fallback below.
  rethrowTenantChanged(error)
  if (error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof FailedMailNotFoundError || error instanceof FailedMailInputError)
    throw createError({ statusCode: error.statusCode })
  throw createError({ statusCode: 500 })
}
