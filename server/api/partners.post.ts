import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { partnerSchema } from '../../shared'
import { createPartner } from '../modules/partners'
import { partnerHttpError } from './partners/http'

/**
 * POST /api/partners
 * A dispatcher or an admin adds a Partner. An invalid body is 400 and is
 * parsed before a session opens. A driver is 403. No session is 401.
 * The response is the row. The audit entry written with it does not contain
 * the name, the phone, the email, or the note.
 */
export default defineEventHandler(async (event) => {
  try {
    return partnerSchema.parse(await createPartner(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    partnerHttpError(error)
  }
})
