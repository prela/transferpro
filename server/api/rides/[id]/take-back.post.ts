import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { handedOffRideResultSchema } from '../../../../shared'
import { takeBackRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/take-back
 * A dispatcher or an admin returns a handed-off Ride to `unassigned`.
 * The body is the version. A missing version, or any other key, is 400
 * and is parsed before a session opens. A mismatch is 409 `stale_save`.
 * A driver is 403. No session is 401. A Ride that is not `handed_off`
 * is 409 `ride_not_handed_off`. An archived Partner can still be taken
 * back. Nothing is written on a refusal. No mail is sent. The body is
 * the Ride, with `partnerId` null, and an empty work-order list.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return handedOffRideResultSchema.parse(await takeBackRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
