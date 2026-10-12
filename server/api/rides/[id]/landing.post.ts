import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { recordedLandingSchema } from '../../../../shared'
import { recordRideLanding } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/landing
 * Record or clear the landing time. The body is `{ landingAt }` — an ISO
 * instant, or null to clear. Any other key is 400 and is parsed before a
 * session opens. A future instant is 409 `landing_time_in_future` and also
 * opens no session. No session is 401. A role other than driver, dispatcher,
 * or admin is 403.
 * A dispatcher or an admin may record it on an unfinished Ride, including
 * `unassigned`. The assigned Driver may record it only while the Ride is
 * theirs. Another Driver is 404. `done`, `no-show`, and `cancelled` are 409
 * `landing_time_closed`, and the stored time stays. The Ride state does not
 * change. The audit entry names the member and the field landingAt, not the
 * instant, a plate, a phone, or a guest. No mail.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return recordedLandingSchema.parse(await recordRideLanding(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
