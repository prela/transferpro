import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { contactPersonListSchema } from '../../../../shared'
import { listContactPersons } from '../../../modules/clients'
import { clientHttpError, parseClientId } from '../http'

/**
 * GET /api/clients/:id/contact-persons
 * This Client's contact persons, by name. A removed person is left out.
 * A driver is 403. No session is 401. Another Tenant's Client is 404.
 * The role check lives in the loader this handler calls.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return contactPersonListSchema.parse(await listContactPersons(toWebRequest(event).headers, clientId))
  }
  catch (error) {
    clientHttpError(error)
  }
})
