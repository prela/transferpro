import { createError, defineEventHandler, toWebRequest } from 'h3'
import { listTenantChoices, TenantAccessError } from '../modules/tenancy'

/**
 * The gate's list. Company name and role only. No tenant session, so a
 * person who has not chosen cannot read that company's Rides or settings.
 */
export default defineEventHandler(async (event) => {
  try {
    return await listTenantChoices(toWebRequest(event).headers)
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
