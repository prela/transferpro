import { defineEventHandler, toWebRequest } from 'h3'
import { clientListSchema } from '../../shared'
import { listClients } from '../modules/clients'
import { clientHttpError } from './clients/http'

/**
 * GET /api/clients
 * This Tenant's Clients. A dispatcher or an admin may read them. A driver
 * is 403. No session is 401. Another Tenant cannot: the table has FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    return clientListSchema.parse(await listClients(toWebRequest(event).headers))
  }
  catch (error) {
    clientHttpError(error)
  }
})
