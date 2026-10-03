import { createError } from 'h3'
import { z } from 'zod'
import { MemberAccessError, TenantAccessError } from '../../modules/tenancy'

/**
 * Turn MemberAccessError and TenantAccessError into HTTP errors.
 * No member email, session token, or user id in the response.
 * The message is a fixed phrase.
 */
export function memberHttpError(error: unknown, defaultStatus = 500): never {
  if (error instanceof MemberAccessError) {
    const message = error.statusCode === 400 ? 'Bad request' : error.message
    throw createError({
      statusCode: error.statusCode,
      statusMessage: message,
    })
  }
  if (error instanceof TenantAccessError) {
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.message,
    })
  }
  // An unknown error's text can carry a role name, a URL, or a row value.
  throw createError({
    statusCode: defaultStatus,
    statusMessage: defaultStatus === 400 ? 'Bad request' : 'Internal server error',
  })
}

/** The `:userId` route param. Anything but a uuid is 400 before the session is read. */
export function parseMemberUserId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  return parsed.data
}
