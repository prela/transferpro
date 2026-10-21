import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { handedOffRideResultSchema } from '../../../../shared'
import { handOffRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/hand-off
 * A dispatcher or an admin hands the Ride to a Partner. The body is the
 * Partner id and the version the form was opened with. A missing version,
 * or any other key, is 400 and is parsed before a session opens. A mismatch
 * is 409 `stale_save`. A driver is 403. No session is 401.
 * `unassigned`, `assigned`, and `accepted` can be handed off. Anything else
 * is 409 `ride_not_handoffable`. An archived Partner is 409
 * `ride_partner_archived`. An unavailable Partner is 409 `ride_unavailable`
 * and writes nothing; `confirm: true` passes it. Another Tenant's Partner
 * or Ride is 404.
 * Nothing is written on a refusal, and no work order is staged.
 * From `assigned` or `accepted` the Driver is mailed no longer yours.
 * A Partner is not mailed. The body is the Ride, including `partnerId`,
 * plus the work-order results. The address is not on it.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return handedOffRideResultSchema.parse(await handOffRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
