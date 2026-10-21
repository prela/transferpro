import { defineEventHandler, getQuery, getRouterParam, toWebRequest } from 'h3'
import { rideHistorySchema } from '../../../../shared'
import { listPartnerRideHistory } from '../../../modules/transfers'
import { transferHttpError } from '../../transfers/http'
import { parsePartnerId } from '../http'

/**
 * GET /api/partners/:id/ride-history
 * The Rides handed to this Partner, open and closed, newest pickup first,
 * 50 per page. Counts cover the whole history. The pickup wall is the
 * Tenant time zone. A dispatcher or an admin may read them. A driver is
 * 403. No session is 401. An unknown Partner, and another Tenant's
 * Partner, are 404. An archived Partner still answers.
 * The role check lives in the loader this handler calls (ADR-0049).
 * `partners` does not import transfers. `cursor` is checked before a
 * session opens. The read writes no audit entry.
 */
export default defineEventHandler(async (event) => {
  const partnerId = parsePartnerId(getRouterParam(event, 'id'))
  try {
    return rideHistorySchema.parse(await listPartnerRideHistory(
      toWebRequest(event).headers,
      partnerId,
      getQuery(event),
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
