import { appendResponseHeader, defineEventHandler, toWebRequest } from 'h3'
import { listPendingInvitations, repairInvitationRequest } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Admin only. The Tenant is the session's. A query cannot choose another.
 * The clear drops a session cookie scoped to this path.
 */
export default defineEventHandler(async (event) => {
  const request = await repairInvitationRequest(toWebRequest(event).headers)
  appendResponseHeader(event, 'set-cookie', request.clearShadow)
  try {
    return await listPendingInvitations(request.headers)
  }
  catch (error) {
    invitationHttpError(error)
  }
})
