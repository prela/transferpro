import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { transferDaySchema } from '../../shared'
import { listTransferDay } from '../modules/transfers'
import { transferHttpError } from './transfers/http'

/**
 * GET /api/transfers
 * Rides whose pickup falls on the operational day named by `date` in the
 * Tenant time zone. That day runs from local 05:00 up to the next local
 * 05:00. A missing date is the operational day that contains now. A
 * dispatcher or an admin may read them. A driver is 403. No session is 401.
 * Another Tenant cannot: the tables have FORCE RLS. Decline alerts for
 * Rides on that day are on the same response. Each Client's live contact
 * persons and Client note are on it too, for the Ride detail and the
 * Transfer form. A removed contact person is left out. A driver is 403
 * before that read (ADR-0049).
 */
export default defineEventHandler(async (event) => {
  try {
    return transferDaySchema.parse(await listTransferDay(toWebRequest(event).headers, getQuery(event).date))
  }
  catch (error) {
    transferHttpError(error)
  }
})
