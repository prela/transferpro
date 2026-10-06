import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { assignRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/assign
 * A dispatcher or an admin assigns a Driver and a Vehicle together.
 * The path is the Ride. Both ids are required. Only one of them is 400
 * and is parsed before a session opens. A driver is 403. No session is 401.
 * An archived Vehicle is 409. A Ride that is not unassigned is 409.
 * The audit entry names the actor and the field names, not a plate or a phone.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  // The path is the Ride. A body rideId cannot name a different one.
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? { ...body, rideId }
    : { rideId }
  try {
    return rideSchema.parse(await assignRide(toWebRequest(event).headers, raw))
  }
  catch (error) {
    rideHttpError(error)
  }
})
