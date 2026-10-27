import { sql } from 'drizzle-orm'
import { CANCELLABLE_RIDE_STATES } from '../../../../shared'

/**
 * Quoted `in` list for a Ride state filter. The names are a fixed set with
 * no quotes of their own, same shape as the `rides_state` check. Parameters
 * would change the statement text without changing which rows match.
 */
export const cancellableRideStatesSql = sql.raw(
  CANCELLABLE_RIDE_STATES.map(state => `'${state}'`).join(', '),
)
