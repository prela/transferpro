import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { vehicleSchema } from '../../../../shared'
import { archiveVehicle } from '../../../modules/vehicles'
import { parseVehicleId, vehicleHttpError } from '../http'

/**
 * POST /api/vehicles/:id/archive
 * Hide the Vehicle from the default list. There is no delete.
 * A second archive writes nothing.
 */
export default defineEventHandler(async (event) => {
  const vehicleId = parseVehicleId(getRouterParam(event, 'id'))
  try {
    return vehicleSchema.parse(await archiveVehicle(toWebRequest(event).headers, vehicleId))
  }
  catch (error) {
    vehicleHttpError(error)
  }
})
