import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { clearRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/clear
 * Return an assigned or accepted Ride to unassigned. The body is empty.
 * Any key is 400 and is parsed before a session opens.
 * A driver is 403. No session is 401.
 * A Ride that is not assigned or accepted is 409 and is unchanged.
 * The audit entry names the office member and the Driver and Vehicle that were cleared.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await clearRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
