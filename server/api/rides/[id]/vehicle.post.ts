import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { assignedRideSchema } from '../../../../shared'
import { changeVehicle } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/vehicle
 * Change only the Vehicle. The Driver, the state, and the copied flag stay.
 * The body is `{ vehicleId }`. Any other key is 400 and is parsed before a session opens.
 * A driver is 403. No session is 401.
 * A Ride that is not assigned or accepted is 409. The same Vehicle is 409.
 * An archived Vehicle is 409. Another Tenant's Ride or Vehicle is 404.
 * The audit entry names the office member and the field vehicleId.
 * The body is the Ride plus one work-order result for the current Driver.
 * The address is not on it. A rejected send does not undo the change.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  // The path is the Ride. A body rideId cannot name a different one.
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? { ...body, rideId }
    : { rideId }
  try {
    return assignedRideSchema.parse(await changeVehicle(toWebRequest(event).headers, raw))
  }
  catch (error) {
    rideHttpError(error)
  }
})
