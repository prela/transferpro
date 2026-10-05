import { createError } from 'h3'
import { z } from 'zod'
import { ClientInputError } from '../../../shared'
import { ClientNotFoundError } from '../../modules/clients'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Client failure into an HTTP error. The message stays a fixed phrase
 * for the status. The screen tells empty name from a bad kind itself.
 */
export function clientHttpError(error: unknown): never {
  if (error instanceof ClientInputError || error instanceof ClientNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseClientId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}
