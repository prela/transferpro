import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { removeTenantMember } from '../../modules/tenancy'
import { memberHttpError } from './http'

/**
 * DELETE /api/members/:userId
 * Remove a member from the Tenant. Admin-only. All sessions for that member
 * in this Tenant are revoked immediately.
 */
export default defineEventHandler(async (event) => {
  try {
    const userId = getRouterParam(event, 'userId')
    if (!userId)
      memberHttpError(new Error('User ID is required.'), 400)
    await removeTenantMember(toWebRequest(event).headers, userId)
    return { removed: true }
  }
  catch (error) {
    memberHttpError(error)
  }
})
