import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { changeMemberRole } from '../../../modules/tenancy'
import { memberHttpError, parseMemberUserId } from '../http'

/**
 * PATCH /api/members/:userId/role
 * Change a member's role. Admin-only. Body: { role: 'admin' | 'dispatcher' | 'driver' }
 */
export default defineEventHandler(async (event) => {
  const userId = parseMemberUserId(getRouterParam(event, 'userId'))

  try {
    await changeMemberRole(toWebRequest(event).headers, userId, await readBody(event))
    return { changed: true }
  }
  catch (error) {
    memberHttpError(error)
  }
})
