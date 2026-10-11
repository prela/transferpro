import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { assignedRideSchema } from '../../../../shared'
import { clearRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/clear
 * Return an assigned or accepted Ride to unassigned. The body is empty.
 * Any key is 400 and is parsed before a session opens.
 * A driver is 403. No session is 401.
 * A Ride that is not assigned or accepted is 409 and is unchanged.
 * The audit entry names the office member and the Driver and Vehicle that were cleared.
 * The body is the Ride plus one work-order result for the Driver who lost it.
 * The address is not on it. A rejected send does not undo the clear.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return assignedRideSchema.parse(await clearRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
