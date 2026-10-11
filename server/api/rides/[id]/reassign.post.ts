import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { rideSchema } from '../../../../shared'
import { reassignRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/reassign
 * Give the Ride to another Driver and a Vehicle. It becomes assigned, and
 * the copied flag is that Driver's current setting. The body is
 * `{ driverId, vehicleId }`. Any other key is 400 and is parsed before a session opens.
 * A driver is 403. No session is 401.
 * A Ride that is not assigned or accepted is 409. The same Driver is 409.
 * An archived Vehicle is 409. Another Tenant's row is 404.
 * The audit entry names the office member and the new ids.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  // The path is the Ride. A body rideId cannot name a different one.
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? { ...body, rideId }
    : { rideId }
  try {
    return rideSchema.parse(await reassignRide(toWebRequest(event).headers, raw))
  }
  catch (error) {
    rideHttpError(error)
  }
})
