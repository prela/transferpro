import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { cancelledRideResultSchema } from '../../../../shared'
import { cancelRide } from '../../../modules/transfers'
import { rideHttpError } from '../http'

/**
 * POST /api/rides/:id/cancel
 * A dispatcher or an admin cancels a Ride from `unassigned`, `assigned`, or
 * `accepted`. The body is empty. Any key is 400 and is parsed before a
 * session opens. No session is 401. A driver, or any other role, is 403 and
 * the Ride is unchanged. A missing Ride, including another Tenant's, is 404.
 * `done`, `no-show`, and a second cancel are 409 `ride_not_cancellable`.
 * Nothing is written on a refusal. The audit entry names the member who
 * cancelled and the field name state. An unassigned Ride stores a null
 * Driver id. A name, a plate, a phone, or a guest is not stored.
 * The current Driver is mailed cancelled after the Ride is saved. A Ride
 * with no Driver sends nothing. The body is `{ ride, workOrders }`.
 * Cancelling a main Transfer also cancels every unfinished extra vehicle.
 * The body then also lists `cancelled`: the named Ride first, then each
 * extra vehicle, each with its own work-order result. A finished extra
 * vehicle is absent. An extra vehicle cancelled on its own omits the list.
 * The address is not on it. A rejected send leaves the Ride cancelled.
 */
export default defineEventHandler(async (event) => {
  const rideId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return cancelledRideResultSchema.parse(await cancelRide(toWebRequest(event).headers, rideId, body))
  }
  catch (error) {
    rideHttpError(error)
  }
})
