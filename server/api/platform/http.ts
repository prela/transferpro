import { createError } from 'h3'
import { PlatformAccessError } from '../../modules/platform'
import { TenantAccessError } from '../../modules/tenancy'

/**
 * 401 and 403 are the gate. 400 and 404 are a superadmin's id or body.
 * The body is the status only, so a name from the request is not echoed.
 */
export function platformHttpError(error: unknown): never {
  if (error instanceof TenantAccessError || error instanceof PlatformAccessError)
    throw createError({ statusCode: error.statusCode })
  throw error
}
