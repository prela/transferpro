import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { suggestAddressesResponseSchema } from '../../../shared'
import { suggestAddresses } from '../../modules/locations'
import { locationHttpError } from './http'

/**
 * POST /api/locations/suggestions
 * A dispatcher or an admin looks up addresses. The body is parsed before a
 * session opens. A driver is 403. No session is 401. The typed text stays
 * in this body and is not logged. The response always succeeds: a provider
 * failure is `available: false`.
 */
export default defineEventHandler(async (event) => {
  try {
    return suggestAddressesResponseSchema.parse(await suggestAddresses(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    locationHttpError(error)
  }
})
