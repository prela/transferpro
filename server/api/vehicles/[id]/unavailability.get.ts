import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { unavailabilityListSchema } from '../../../../shared'
import { listVehicleUnavailability } from '../../../modules/transfers'
import { unavailabilityHttpError } from '../../unavailability/http'

/**
 * GET /api/vehicles/:id/unavailability
 * The live windows of one Vehicle, archived or not, earliest first.
 * Office only. A Vehicle not in this Tenant is 404.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilityListSchema.parse({ windows: await listVehicleUnavailability(toWebRequest(event).headers, getRouterParam(event, 'id')) })
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
