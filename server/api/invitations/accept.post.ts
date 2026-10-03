import { appendResponseHeader, defineEventHandler, getRequestIP, readBody, toWebRequest } from 'h3'
import { acceptMemberInvitation } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Creates an account only for a valid invitation, or accepts one for a
 * session whose email matches. Rate limit matches email sign-in.
 */
export default defineEventHandler(async (event) => {
  try {
    const result = await acceptMemberInvitation(
      await readBody(event),
      toWebRequest(event).headers,
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
