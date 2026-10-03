import { createError, defineEventHandler, toWebRequest } from 'h3'
import { TenantAccessError, withTenantFromSession } from '../modules/tenancy'

/**
 * Proves the session. Slice 2 replaces this with the signed-in shell.
 * The body is the tenant id only.
 */
export default defineEventHandler(async (event) => {
  try {
    return await withTenantFromSession(toWebRequest(event).headers, async ({ context }) => {
      return { tenantId: context.tenantId }
    })
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
