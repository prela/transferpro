import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { locationListSchema } from '../../shared'
import { listLocations } from '../modules/locations'
import { locationHttpError, parseIncludeArchived } from './locations/http'

/**
 * GET /api/locations
 * This Tenant's Locations. A dispatcher or an admin may read them. A driver
 * is 403. No session is 401. Another Tenant cannot: the table has FORCE RLS.
 * Archived rows are omitted unless includeArchived=true.
 */
export default defineEventHandler(async (event) => {
  try {
    const includeArchived = parseIncludeArchived(getQuery(event).includeArchived)
    return locationListSchema.parse(await listLocations(toWebRequest(event).headers, includeArchived))
  }
  catch (error) {
    locationHttpError(error)
  }
})
