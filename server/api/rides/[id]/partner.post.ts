import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { handedOffRideResultSchema } from '../../../../shared'
import { changeRidePartner } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/partner
 * A dispatcher or an admin gives a handed-off Ride to another active
 * Partner. The body is the Partner id and the version. A missing version,
 * or any other key, is 400 and is parsed before a session opens. A mismatch
 * is 409 `stale_save`. A driver is 403. No session is 401.
 * A Ride that is not `handed_off` is 409 `ride_not_handed_off`. The same
 * active Partner is 409 `ride_partner_unchanged`. An archived Partner is
 * 409 `ride_partner_archived`. An unavailable Partner is 409
 * `ride_unavailable` and writes nothing; `confirm: true` passes it.
 * Another Tenant's Partner or Ride is 404.
 * Nothing is written on a refusal. No mail is sent. The body is the Ride,
 * including `partnerId`, and an empty work-order list.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return handedOffRideResultSchema.parse(await changeRidePartner(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
