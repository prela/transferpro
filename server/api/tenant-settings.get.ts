import { createError, defineEventHandler, toWebRequest } from 'h3'
import { tenantSettingsGetSchema, tenantTimeZoneIds } from '../../shared'
import { readTenantSettings, TenantAccessError } from '../modules/tenancy'

/**
 * GET /api/tenant-settings
 * The current Tenant's No-show waits and time zone. Admin, dispatcher, and
 * driver may read them. Another Tenant cannot: the row is behind FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    const settings = await readTenantSettings(toWebRequest(event).headers)
    // The list is this process's, so the browser cannot offer a zone the write refuses.
    return tenantSettingsGetSchema.parse({ ...settings, timeZones: tenantTimeZoneIds })
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
