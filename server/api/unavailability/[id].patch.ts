import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { unavailabilitySavedSchema } from '../../../shared'
import { changeUnavailability } from '../../modules/transfers'
import { unavailabilityHttpError } from './http'

/**
 * PATCH /api/unavailability/:id
 * Move a window's start and end. The Driver or Vehicle of a window does not
 * change. A removed or unknown window is 404. A save that moves nothing
 * writes and audits nothing. The response is the window and the Rides it
 * now covers.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilitySavedSchema.parse(await changeUnavailability(toWebRequest(event).headers, getRouterParam(event, 'id'), await readBody(event)))
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
