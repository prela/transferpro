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
 * Another Tenant cannot: the tables have FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    return transferDaySchema.parse(await listTransferDay(toWebRequest(event).headers, getQuery(event).date))
  }
  catch (error) {
    transferHttpError(error)
  }
})
