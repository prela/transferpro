import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { unavailabilityListSchema } from '../../../../shared'
import { listPartnerUnavailability } from '../../../modules/transfers'
import { unavailabilityHttpError } from '../../unavailability/http'

/**
 * GET /api/partners/:id/unavailability
 * The live windows of one Partner, archived or not, earliest first.
 * Office only. A Partner not in this Tenant is 404.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilityListSchema.parse({ windows: await listPartnerUnavailability(toWebRequest(event).headers, getRouterParam(event, 'id')) })
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
