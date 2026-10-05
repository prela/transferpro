import { appendResponseHeader, defineEventHandler, getRequestIP, readBody, toWebRequest } from 'h3'
import { acceptMemberInvitation, repairInvitationRequest } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Creates an account only for a valid invitation, or accepts one for a
 * session whose email matches. Rate limit matches email sign-in.
 * The clear drops a session cookie scoped to this path. It does not
 * touch the Path=/ session.
 */
export default defineEventHandler(async (event) => {
  const request = await repairInvitationRequest(toWebRequest(event).headers)
  appendResponseHeader(event, 'set-cookie', request.clearShadow)
  try {
    const result = await acceptMemberInvitation(
      await readBody(event),
      request.headers,
      getRequestIP(event) ?? 'unknown',
    )
    for (const cookie of result.cookies)
      appendResponseHeader(event, 'set-cookie', cookie)
    return { ok: true }
  }
  catch (error) {
    invitationHttpError(error)
  }
})
