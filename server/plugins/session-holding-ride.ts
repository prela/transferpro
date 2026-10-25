import { setHoldingRideQuery } from '../modules/tenancy'
import { driverHasHoldingRide } from '../modules/transfers'

/**
 * Tenancy asks whether a Ride holds this Driver's session.
 * The query stays in transfers (ADR-0057).
 */
export default defineNitroPlugin(() => {
  setHoldingRideQuery(driverHasHoldingRide)
})
