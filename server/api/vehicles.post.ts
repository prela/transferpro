import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { vehicleSchema } from '../../shared'
import { createVehicle } from '../modules/vehicles'
import { vehicleHttpError } from './vehicles/http'

/**
 * POST /api/vehicles
 * A dispatcher or an admin adds a Vehicle. An invalid body is 400 and is
 * parsed before a session opens. A driver is 403. No session is 401.
 * The response is the row. The audit entry written with it does not contain the plate.
 */
export default defineEventHandler(async (event) => {
  try {
    return vehicleSchema.parse(await createVehicle(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    vehicleHttpError(error)
  }
})
