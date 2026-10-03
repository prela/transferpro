import { createError } from 'h3'
import { MemberAccessError, TenantAccessError } from '../../modules/tenancy'

/**
 * Turn MemberAccessError and TenantAccessError into HTTP errors.
 * No member email, session token, or user id in the response.
 * The message is a fixed phrase.
 */
export function memberHttpError(error: unknown, defaultStatus = 500): never {
  if (error instanceof MemberAccessError) {
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.message,
    })
  }
  if (error instanceof TenantAccessError) {
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.message,
    })
  }
  throw createError({
    statusCode: defaultStatus,
    statusMessage: 'Internal server error',
  })
}
