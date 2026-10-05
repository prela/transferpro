import { createError } from 'h3'
import { z } from 'zod'
import { DriverInputError } from '../../../shared'
import { DriverNotFoundError } from '../../modules/drivers'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * Turn a Driver failure into an HTTP error. The message stays a fixed phrase
 * for the status. A phone number is not copied from the thrown error.
 */
export function driverHttpError(error: unknown): never {
  if (error instanceof DriverInputError || error instanceof DriverNotFoundError || error instanceof TenantAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}

/** The `:id` route param. Anything but a uuid is 400 before the session is read. */
export function parseDriverId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  return parsed.data
}
