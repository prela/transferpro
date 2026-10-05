import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { driverListSchema } from '../../shared'
import { listDrivers } from '../modules/drivers'
import { driverHttpError, parseIncludeArchived } from './drivers/http'

/**
 * GET /api/drivers
 * This Tenant's Drivers. A dispatcher or an admin may read them. A driver
 * is 403. No session is 401. Another Tenant cannot: the table has FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    parseIncludeArchived(getQuery(event).includeArchived)
    return driverListSchema.parse(await listDrivers(toWebRequest(event).headers))
  }
  catch (error) {
    driverHttpError(error)
  }
})
