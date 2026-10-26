import { createError } from 'h3'
import { invitationIdSchema } from '../../../shared'
import { InvitationAccessError, TenantAccessError } from '../../modules/tenancy'
import { rethrowTenantChanged } from '../tenant-changed'

/**
 * Zod and Better Auth errors can carry the invitation id or the email.
 * The response is only a status, which the error handler turns into a fixed phrase.
 */
export function invitationHttpError(error: unknown): never {
  rethrowTenantChanged(error)
  if (error instanceof InvitationAccessError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}

/** The `:invitationId` route param. Anything but a uuid is 400 before the session is read. */
export function parseInvitationId(raw: unknown): string {
  const parsed = invitationIdSchema.safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  return parsed.data
}
