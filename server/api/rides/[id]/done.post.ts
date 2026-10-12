import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { markRideDone } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/done
 * The Driver marks their own Ride done, or the office marks any Ride in the
 * Tenant. The body is empty. Any key is 400 and is parsed before a session
 * opens. No session is 401. A role other than driver, dispatcher, or admin
 * is 403. With the copied flag off, done is reachable from `assigned`. With
 * the flag on, done is reachable only from `accepted`. Anything else is 409
 * `ride_not_finishable`, and a Ride the Driver does not hold is 404. Nothing
 * is written on a refusal. The audit entry names the member who marked it
 * done and the field name state, not a plate, a phone, or a guest. No mail.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await markRideDone(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
