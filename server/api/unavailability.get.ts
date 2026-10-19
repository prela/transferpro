import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { unavailabilityListSchema } from '../../shared'
import { listUnavailabilityWeek } from '../modules/transfers'
import { unavailabilityHttpError } from './unavailability/http'

/**
 * GET /api/unavailability?week=YYYY-MM-DD
 * The live windows that touch one roster week, Monday to Sunday in the
 * Tenant time zone. `week` is its Monday. Office only; a driver is 403.
 * The roster grid shows these without editing.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilityListSchema.parse({ windows: await listUnavailabilityWeek(toWebRequest(event).headers, getQuery(event).week) })
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
