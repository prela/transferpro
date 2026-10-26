import { appendResponseHeader, defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { repairInvitationRequest, revokePendingInvitation } from '../../../modules/tenancy'
import { readOfficeBody } from '../../tenant-changed'
import { invitationHttpError, parseInvitationId } from '../http'

/**
 * Admin only. The id is checked before the session, so a non-uuid is 400
 * even when no one is signed in. The Tenant is the session's.
 */
export default defineEventHandler(async (event) => {
  const invitationId = parseInvitationId(getRouterParam(event, 'invitationId'))
  const request = await repairInvitationRequest(toWebRequest(event).headers)
  appendResponseHeader(event, 'set-cookie', request.clearShadow)
  try {
    await revokePendingInvitation(request.headers, invitationId, await readOfficeBody(event))
    return { revoked: true }
  }
  catch (error) {
    invitationHttpError(error)
  }
})
