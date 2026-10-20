import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { contactPersonSchema } from '../../../../../shared'
import { updateContactPerson } from '../../../../modules/clients'
import { clientHttpError, parseClientId } from '../../http'

/**
 * PATCH /api/clients/:id/contact-persons/:contactPersonId
 * Correct the name, the role, the phone, or the email. The body carries the
 * version the form opened with. A mismatch is 409 `stale_save`.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  const contactPersonId = parseClientId(getRouterParam(event, 'contactPersonId'))
  try {
    return contactPersonSchema.parse(await updateContactPerson(
      toWebRequest(event).headers,
      clientId,
      contactPersonId,
      await readBody(event),
    ))
  }
  catch (error) {
    clientHttpError(error)
  }
})
