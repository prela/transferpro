import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { z } from 'zod'
import { removeTenantMember } from '../../modules/tenancy'
import { memberHttpError } from './http'

/**
 * DELETE /api/members/:userId
 * Remove a member from the Tenant. Admin-only. All sessions for that member
 * in this Tenant are revoked immediately.
 */
export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  const parsed = z.uuid().safeParse(userId)
  if (!parsed.success)
    memberHttpError(new Error('Invalid user ID.'), 400)

  try {
    await removeTenantMember(toWebRequest(event).headers, parsed.data)
    return { removed: true }
  }
  catch (error) {
    memberHttpError(error)
  }
})
