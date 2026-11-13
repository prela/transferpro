import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { recordPartnerConfirmation } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/partner-confirmation
 * A dispatcher or an admin records that the Partner agreed to a handed-off
 * Ride. The body is the version the form was opened with. A missing version,
 * or any other key, is 400 and is parsed before a session opens. A driver
 * is 403. No session is 401. Another Tenant's Ride, or no such Ride, is 404.
 * A version mismatch is 409 `stale_save`. Any Ride that is not a handoff
 * waiting on Partner confirmation is 409 `ride_not_awaiting_partner_confirmation`.
 * Nothing is written on a refusal. Success sets the flag, appends
 * `ride.partner_confirmed`, and changes the version once (ADR-0062).
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return await recordPartnerConfirmation(toWebRequest(event).headers, rideId, body)
  }
  catch (error) {
    rideHttpError(error)
  }
})
