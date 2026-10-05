import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { clientSchema } from '../../../shared'
import { updateClient } from '../../modules/clients'
import { clientHttpError, parseClientId } from './http'

/**
 * PATCH /api/clients/:id
 * Correct the name, the kind, or both. An unknown id in this Tenant is 404.
 * A body that matches the row writes nothing and appends nothing.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return clientSchema.parse(await updateClient(toWebRequest(event).headers, clientId, await readBody(event)))
  }
  catch (error) {
    clientHttpError(error)
  }
})
