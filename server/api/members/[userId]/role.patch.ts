import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { changeMemberRole } from '../../../modules/tenancy'
import { memberHttpError } from '../http'

/**
 * PATCH /api/members/:userId/role
 * Change a member's role. Admin-only. Body: { role: 'admin' | 'dispatcher' | 'driver' }
 */
export default defineEventHandler(async (event) => {
  try {
    const userId = getRouterParam(event, 'userId')
    if (!userId)
      memberHttpError(new Error('User ID is required.'), 400)
    await changeMemberRole(toWebRequest(event).headers, userId, await readBody(event))
    return { changed: true }
  }
  catch (error) {
    memberHttpError(error)
  }
})
