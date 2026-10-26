import { createError } from 'h3'
import { UnavailabilityInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { UnavailabilityArchivedError, UnavailabilityNotFoundError } from '../../modules/transfers'
import { rethrowTenantChanged } from '../tenant-changed'

/**
 * Turn an unavailability window failure into an HTTP error. The message
 * stays a fixed phrase for the status; no instant, name, or plate is copied
 * from the thrown error. `unavailability_archived` is a new or moved window
 * on an archived Driver or Vehicle. Nothing was written.
 */
export function unavailabilityHttpError(error: unknown): never {
  rethrowTenantChanged(error)
  if (error instanceof UnavailabilityInputError || error instanceof UnavailabilityNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof UnavailabilityArchivedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}
