import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { clientSchema } from '../../shared'
import { createClient } from '../modules/clients'
import { clientHttpError } from './clients/http'

/**
 * POST /api/clients
 * A dispatcher or an admin adds a Client. An invalid body is 400 and is
 * parsed before a session opens. A driver is 403. No session is 401.
 */
export default defineEventHandler(async (event) => {
  try {
    return clientSchema.parse(await createClient(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    clientHttpError(error)
  }
})
