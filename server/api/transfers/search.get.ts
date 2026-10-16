import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { transferSearchSchema } from '../../../shared'
import { searchTransfers } from '../../modules/transfers'
import { transferHttpError } from './http'

/**
 * GET /api/transfers/search?q=
 * Transfers on any operational day whose guest, Client reference, or flight
 * number contains `q`. Today and later come first, earliest pickup first.
 * Past operational days follow, newest first. At most 20 rows. The result
 * names the Ride and the operational day the board opens. A dispatcher or
 * an admin may read them. A driver is 403.
 * No session is 401. Another Tenant cannot: the tables have FORCE RLS.
 * `q` is checked before a session opens. It is not logged and not audited.
 */
export default defineEventHandler(async (event) => {
  try {
    return transferSearchSchema.parse(
      await searchTransfers(toWebRequest(event).headers, getQuery(event).q),
    )
  }
  catch (error) {
    transferHttpError(error)
  }
})
