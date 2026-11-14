import { defineEventHandler, toWebRequest } from 'h3'
import { officeHomeSchema } from '../../shared'
import { readOfficeHome } from '../modules/transfers'
import { officeHomeHttpError } from './office-home/http'
import { officeNow } from './office-now'

/**
 * GET /api/office-home
 * One snapshot: the unassigned list, the waiting-on-acceptance list, the
 * in-progress list, the handoffs waiting on Partner confirmation, the
 * eight counts for the operational day that contains now, and the failed
 * work orders that still matter.
 * An unassigned row carries a decline alert for any day.
 * A dispatcher or an admin may read it. A driver is 403.
 * No session is 401. Another Tenant cannot: the tables have FORCE RLS.
 * The read writes nothing.
 */
export default defineEventHandler(async (event) => {
  try {
    const headers = toWebRequest(event).headers
    return officeHomeSchema.parse(await readOfficeHome(headers, officeNow(headers)))
  }
  catch (error) {
    officeHomeHttpError(error)
  }
})
