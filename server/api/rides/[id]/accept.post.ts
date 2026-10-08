import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { acceptRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/accept
 * The Driver accepts their own assigned Ride when the copied flag is on.
 * The body is empty. Any key is 400 and is parsed before a session opens.
 * A dispatcher or an admin is 403. No session is 401.
 * A Ride that is not assigned, or whose copied flag is off, is 409.
 * Another Driver's Ride, another Tenant's Ride, and a member with no
 * linked Driver are 404. The audit entry names the Driver's member and
 * the field name state, not a plate, a phone, or a guest.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await acceptRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
