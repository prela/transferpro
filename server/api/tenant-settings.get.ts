import { createError, defineEventHandler, toWebRequest } from 'h3'
import { readTenantSettings, TenantAccessError } from '../modules/tenancy'

/**
 * GET /api/tenant-settings
 * The current Tenant's No-show waits and time zone. Admin, dispatcher, and
 * driver may read them. Another Tenant cannot: the row is behind FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    return await readTenantSettings(toWebRequest(event).headers)
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
