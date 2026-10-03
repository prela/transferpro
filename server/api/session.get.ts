import { createError, defineEventHandler, toWebRequest } from 'h3'
import { readSessionShell, TenantAccessError } from '../modules/tenancy'

/**
 * The signed-in shell reads this. Same cookie path as sign-in:
 * `readSessionShell` opens one tenant session through `withTenantFromSession`.
 * The body includes `tenantId`.
 */
export default defineEventHandler(async (event) => {
  try {
    return await readSessionShell(toWebRequest(event).headers)
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
