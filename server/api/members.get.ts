import { defineEventHandler, toWebRequest } from 'h3'
import { listMembers } from '../modules/tenancy'
import { memberHttpError } from './members/http'

/**
 * GET /api/members
 * List all members of the current Tenant. Admin and dispatcher only; drivers get 403.
 */
export default defineEventHandler(async (event) => {
  try {
    return await listMembers(toWebRequest(event).headers)
  }
  catch (error) {
    memberHttpError(error)
  }
})
