import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { acceptRideByPhone } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/accept-by-phone
 * A dispatcher or an admin records acceptance after confirming with the Driver
 * by phone. The body is `{ driverId }`, the Driver the dialog showed. A
 * missing or malformed id, or any other key, is 400 and is parsed before a
 * session opens. A driver is 403. No session is 401. Another Tenant's Ride
 * is 404. A Ride that now has a different Driver is 409 `ride_driver_changed`.
 * A Ride that is not assigned, whose copied flag is off, or that has no
 * Driver is 409 `ride_not_acceptable`. The version is not read (ADR-0046).
 * The audit entry names the office member and the field name state, not a
 * plate, a phone, or a guest. No mail is sent.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return rideSchema.parse(await acceptRideByPhone(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
