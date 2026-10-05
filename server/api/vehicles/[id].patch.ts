import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { vehicleSchema } from '../../../shared'
import { updateVehicle } from '../../modules/vehicles'
import { parseVehicleId, vehicleHttpError } from './http'

/**
 * PATCH /api/vehicles/:id
 * Correct the fields in the body. An unknown id in this Tenant is 404.
 * A body that matches the row writes nothing and appends nothing.
 * Archive is POST /api/vehicles/:id/archive.
 */
export default defineEventHandler(async (event) => {
  const vehicleId = parseVehicleId(getRouterParam(event, 'id'))
  try {
    return vehicleSchema.parse(await updateVehicle(toWebRequest(event).headers, vehicleId, await readBody(event)))
  }
  catch (error) {
    vehicleHttpError(error)
  }
})
