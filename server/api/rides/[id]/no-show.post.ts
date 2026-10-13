import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { markNoShow } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/no-show
 * The Driver marks their own Ride a No-show after the wait, or the office
 * marks any Ride in the Tenant, including before the wait. The body is empty.
 * Any key is 400 and is parsed before a session opens. No session is 401.
 * A role other than driver, dispatcher, or admin is 403. With the copied flag
 * off, a No-show is reachable from `assigned`. With the flag on, only from
 * `accepted`. Anything else is 409 `ride_not_no_show`. A Driver who marks it
 * before the wait is 409 `no_show_too_early`, and the Ride is unchanged. A
 * Ride the Driver does not hold is 404. Nothing is written on a refusal. The
 * audit entry names the member. An early office No-show is `ride.no_show_early`.
 * A No-show after the wait is `ride.no_show`. Neither stores a fee. No mail.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await markNoShow(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
