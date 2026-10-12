import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { declineRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/decline
 * The Driver declines their own Ride from `assigned`. The body is empty.
 * Any key is 400 and is parsed before a session opens. No session is 401.
 * A role other than driver is 403. The Ride returns to `unassigned` with no
 * Driver, no Vehicle, and no copied flag, and a decline alert names that
 * Driver. `accepted` is 409 `ride_not_declinable`. A Ride the Driver does
 * not hold is 404. Nothing is written on a refusal. The audit entry names
 * the Driver and the field names, not a plate, a phone, or a guest. No mail.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await declineRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
