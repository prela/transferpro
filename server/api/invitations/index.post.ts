import { appendResponseHeader, defineEventHandler, readBody, toWebRequest } from 'h3'
import { invitationMailOutbox } from '../../modules/mail'
import { inviteMember, repairInvitationRequest } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Admin only. The invite call refuses a dispatcher or a driver with 403
 * itself, and Better Auth's role check refuses them again.
 * The body is email and role. The organization is the session's Tenant.
 * The response is the copyable link and what happened to the mail. The
 * mail goes through the outbox, so a failed first send is retried.
 * The clear drops a session cookie scoped to this path. It does not
 * touch the Path=/ session.
 */
export default defineEventHandler(async (event) => {
  const request = await repairInvitationRequest(toWebRequest(event).headers)
  appendResponseHeader(event, 'set-cookie', request.clearShadow)
  try {
    return await inviteMember(request.headers, await readBody(event), invitationMailOutbox())
  }
  catch (error) {
    invitationHttpError(error)
  }
})
