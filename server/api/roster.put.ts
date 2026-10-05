import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { setRosterResultSchema } from '../../shared'
import { setRosterDay } from '../modules/roster'
import { rosterHttpError } from './roster/http'

/**
 * PUT /api/roster
 * Set or clear one Driver's Vehicle for one calendar date. An invalid body
 * is 400 and is parsed before a session opens. A driver is 403. No session
 * is 401. The audit entry written with a real change does not contain a plate.
 */
export default defineEventHandler(async (event) => {
  try {
    return setRosterResultSchema.parse(await setRosterDay(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    rosterHttpError(error)
  }
})
