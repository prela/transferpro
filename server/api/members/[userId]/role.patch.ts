import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { z } from 'zod'
import { changeMemberRole } from '../../../modules/tenancy'
import { memberHttpError } from '../http'

/**
 * PATCH /api/members/:userId/role
 * Change a member's role. Admin-only. Body: { role: 'admin' | 'dispatcher' | 'driver' }
 */
export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  const parsed = z.uuid().safeParse(userId)
  if (!parsed.success)
    memberHttpError(new Error('Invalid user ID.'), 400)

  try {
    await changeMemberRole(toWebRequest(event).headers, parsed.data, await readBody(event))
    return { changed: true }
  }
  catch (error) {
    memberHttpError(error)
  }
})
