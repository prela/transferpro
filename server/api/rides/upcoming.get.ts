import { defineEventHandler, toWebRequest } from 'h3'
import { driverUpcomingListSchema } from '../../../shared'
import { listUpcomingRides } from '../../modules/transfers'
import { rideHttpError } from './http'

/**
 * GET /api/rides/upcoming
 * The signed-in Driver's Rides in `assigned` or `accepted`, soonest pickup
 * first. The Driver is the one linked to this member. A driver id on the
 * query is ignored. No linked Driver is an empty list. A dispatcher or an
 * admin is 403. No session is 401. Another Tenant cannot: the tables have
 * FORCE RLS, and the per-driver filter runs inside that transaction.
 * Cash includes the price. Card and invoice to agency include neither.
 * Each Ride includes `state` (`assigned` or `accepted`) and `mustAccept`.
 * This route does not accept a Ride.
 */
export default defineEventHandler(async (event) => {
  try {
    return driverUpcomingListSchema.parse(await listUpcomingRides(toWebRequest(event).headers))
  }
  catch (error) {
    rideHttpError(error)
  }
})
