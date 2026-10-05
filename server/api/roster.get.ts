import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { rosterDaySchema } from '../../shared'
import { listRosterDay } from '../modules/roster'
import { rosterHttpError } from './roster/http'

/**
 * GET /api/roster?date=YYYY-MM-DD
 * This Tenant's assignments for one calendar date. A dispatcher or an admin
 * may read them. A driver is 403. No session is 401. Another Tenant cannot:
 * the table has FORCE RLS.
 */
export default defineEventHandler(async (event) => {
  try {
    return rosterDaySchema.parse(await listRosterDay(toWebRequest(event).headers, getQuery(event).date))
  }
  catch (error) {
    rosterHttpError(error)
  }
})
