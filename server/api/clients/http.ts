import { createError } from 'h3'
import { z } from 'zod'
import { ClientInputError, StaleSaveError } from '../../../shared'
import { ClientNotFoundError } from '../../modules/clients'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Client failure into an HTTP error. The message stays a fixed phrase
 * for the status. The screen tells empty name from a bad kind itself.
 * `stale_save` is a version the form no longer holds. Nothing was written,
 * and the body names no one (ADR-0046, ADR-0012).
 */
export function clientHttpError(error: unknown): never {
  if (error instanceof ClientInputError || error instanceof ClientNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof StaleSaveError)
    throw createError({ statusCode: error.statusCode, data: { code: error.code } })
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseClientId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}
