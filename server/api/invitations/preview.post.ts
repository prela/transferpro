import { defineEventHandler, readBody } from 'h3'
import { previewMemberInvitation } from '../../modules/tenancy'
import { invitationHttpError } from './http'

/**
 * Public. The id arrives in the body, not the path, so a request log of the
 * URL does not carry the bearer secret. The response is a state, not the email.
 */
export default defineEventHandler(async (event) => {
  try {
    return await previewMemberInvitation(await readBody(event))
  }
  catch (error) {
    invitationHttpError(error)
  }
})
