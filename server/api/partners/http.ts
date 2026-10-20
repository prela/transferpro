import { createError } from 'h3'
import { z } from 'zod'
import { parseIncludeArchivedQuery, PartnerInputError, QueryParamError } from '../../../shared'
import { PartnerArchivedError, PartnerNotFoundError } from '../../modules/partners'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Partner failure into an HTTP error. The message stays a fixed phrase
 * for the status. A phone, an email, or a note is not copied from the thrown error.
 */
export function partnerHttpError(error: unknown): never {
  if (error instanceof PartnerInputError || error instanceof PartnerNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof PartnerArchivedError) {
    throw createError({
      statusCode: error.statusCode,
      data: { code: error.code },
    })
  }
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parsePartnerId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}

/** Default list hides archived Partners. Only the string true includes them. */
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
