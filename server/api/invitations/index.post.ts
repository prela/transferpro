import { appendResponseHeader, defineEventHandler, readBody, toWebRequest } from 'h3'
import { inviteMember, repairInvitationRequest } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Admin only. Dispatcher and driver get 403 from Better Auth's role check.
 * The body is email and role. The organization is the session's Tenant.
 * The clear drops a session cookie scoped to this path. It does not
 * touch the Path=/ session.
 */
export default defineEventHandler(async (event) => {
  const request = await repairInvitationRequest(toWebRequest(event).headers)
  appendResponseHeader(event, 'set-cookie', request.clearShadow)
  try {
    return await inviteMember(request.headers, await readBody(event))
  }
  catch (error) {
    invitationHttpError(error)
  }
})
