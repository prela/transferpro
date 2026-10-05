import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { vehicleListSchema } from '../../shared'
import { listVehicles } from '../modules/vehicles'
import { parseIncludeArchived, vehicleHttpError } from './vehicles/http'

/**
 * GET /api/vehicles
 * This Tenant's Vehicles. A dispatcher or an admin may read them. A driver
 * is 403. No session is 401. Another Tenant cannot: the table has FORCE RLS.
 * Archived rows are omitted unless includeArchived=true.
 */
export default defineEventHandler(async (event) => {
  try {
    const includeArchived = parseIncludeArchived(getQuery(event).includeArchived)
    return vehicleListSchema.parse(await listVehicles(toWebRequest(event).headers, includeArchived))
  }
  catch (error) {
    vehicleHttpError(error)
  }
})
