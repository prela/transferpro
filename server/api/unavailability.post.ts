import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { unavailabilitySavedSchema } from '../../shared'
import { addUnavailability } from '../modules/transfers'
import { unavailabilityHttpError } from './unavailability/http'

/**
 * POST /api/unavailability
 * A dispatcher or an admin marks one Driver, one Vehicle, or one Partner
 * unavailable from one instant to a later one (ADR-0034). The body names
 * exactly one id. An
 * invalid body is 400 before a session opens. A driver is 403. A Driver or
 * Vehicle not in this Tenant is 404; an archived one is 409. The response is
 * the window and the assigned or accepted Rides it now covers. The save
 * takes the Tenant capacity lock and appends ids and field names only.
 */
export default defineEventHandler(async (event) => {
  try {
    return unavailabilitySavedSchema.parse(await addUnavailability(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
