import { createError } from 'h3'
import { MemberAccessError } from '../../modules/tenancy'

/**
 * Turn MemberAccessError into an HTTP error. No member email, session token,
 * or user id in the response. The message is a fixed phrase.
 */
export function memberHttpError(error: unknown, defaultStatus = 500): never {
  if (error instanceof MemberAccessError) {
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
