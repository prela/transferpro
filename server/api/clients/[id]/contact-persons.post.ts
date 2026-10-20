import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { contactPersonSchema } from '../../../../shared'
import { createContactPerson } from '../../../modules/clients'
import { clientHttpError, parseClientId } from '../http'

/**
 * POST /api/clients/:id/contact-persons
 * A dispatcher or an admin adds a contact person. An invalid body is 400
 * and is parsed before a session opens. Adding sends no version.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return contactPersonSchema.parse(await createContactPerson(toWebRequest(event).headers, clientId, await readBody(event)))
  }
  catch (error) {
    clientHttpError(error)
  }
})
