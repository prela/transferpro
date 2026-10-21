import { defineEventHandler, getQuery, getRouterParam, toWebRequest } from 'h3'
import { rideHistorySchema } from '../../../../shared'
import { listClientRideHistory } from '../../../modules/transfers'
import { transferHttpError } from '../../transfers/http'
import { parseClientId } from '../http'

/**
 * GET /api/clients/:id/ride-history
 * This Client's Rides, every state, newest pickup first, 50 per page.
 * Counts cover the whole history. The pickup wall is the Tenant time zone.
 * A dispatcher or an admin may read them. A driver is 403. No session is
 * 401. An unknown Client, and another Tenant's Client, are 404.
 * The role check lives in the loader this handler calls (ADR-0049).
 * `clients` does not import transfers. `cursor` is checked before a session
 * opens. The read writes no audit entry.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return rideHistorySchema.parse(await listClientRideHistory(
      toWebRequest(event).headers,
      clientId,
      getQuery(event),
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
