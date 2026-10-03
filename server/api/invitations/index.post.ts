import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { inviteMember } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Admin only. Dispatcher and driver get 403 from Better Auth's role check.
 * The body is email and role. The organization is the session's Tenant.
 */
export default defineEventHandler(async (event) => {
  try {
    return await inviteMember(toWebRequest(event).headers, await readBody(event))
  }
  catch (error) {
    invitationHttpError(error)
  }
})
