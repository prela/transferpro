import { createError } from 'h3'
import { InvitationAccessError, TenantAccessError } from '../../modules/tenancy'

/**
 * Zod and Better Auth errors can carry the invitation id or the email.
 * The response is only a status, which the error handler turns into a fixed phrase.
 */
export function invitationHttpError(error: unknown): never {
  if (error instanceof InvitationAccessError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}
