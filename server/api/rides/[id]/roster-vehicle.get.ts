import { defineEventHandler, getQuery, getRouterParam, toWebRequest } from 'h3'
import { rosterVehicleSuggestionSchema } from '../../../../shared'
import { rosterVehicleForRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * GET /api/rides/:id/roster-vehicle?driverId=
 * The Vehicle the roster gives that Driver on the Ride's pickup day.
 * A missing row, or an archived Vehicle, is `{ vehicleId: null }`.
 * The read does not assign. A driver is 403. No session is 401.
 */
export default defineEventHandler(async (event) => {
  try {
    return rosterVehicleSuggestionSchema.parse(await rosterVehicleForRide(
      toWebRequest(event).headers,
      getRouterParam(event, 'id'),
      getQuery(event).driverId,
    ))
  }
  catch (error) {
    rideHttpError(error)
  }
})
