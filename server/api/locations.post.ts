import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { locationSchema } from '../../shared'
import { createLocation } from '../modules/locations'
import { locationHttpError } from './locations/http'

/**
 * POST /api/locations
 * A dispatcher or an admin adds a Location. An invalid body is 400 and is
 * parsed before a session opens. A driver is 403. No session is 401.
 * The response is the row. The audit entry written with it does not contain the address.
 */
export default defineEventHandler(async (event) => {
  try {
    return locationSchema.parse(await createLocation(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    locationHttpError(error)
  }
})
