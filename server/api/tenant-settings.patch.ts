import { createError, defineEventHandler, readBody, toWebRequest } from 'h3'
import { TenantSettingsError, tenantSettingsResponseSchema } from '../../shared'
import { TenantAccessError, updateTenantSettings } from '../modules/tenancy'

/**
 * PATCH /api/tenant-settings
 * An admin changes either wait, the time zone, the operational-day start, or
 * any of them together. A dispatcher or a driver is 403. An invalid body is
 * 400 and is parsed before a session opens. A body that matches the stored
 * row writes nothing.
 */
export default defineEventHandler(async (event) => {
  try {
    return tenantSettingsResponseSchema.parse(await updateTenantSettings(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    if (error instanceof TenantSettingsError)
      throw createError({ statusCode: error.statusCode })
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
