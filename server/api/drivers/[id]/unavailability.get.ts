import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { unavailabilityListSchema } from '../../../../shared'
import { listDriverUnavailability } from '../../../modules/transfers'
import { unavailabilityHttpError } from '../../unavailability/http'

/**
 * GET /api/drivers/:id/unavailability
 * The live windows of one Driver, archived or not, earliest first.
 * Office only. A Driver not in this Tenant is 404.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilityListSchema.parse({ windows: await listDriverUnavailability(toWebRequest(event).headers, getRouterParam(event, 'id')) })
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
