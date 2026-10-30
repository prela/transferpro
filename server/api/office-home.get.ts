import process from 'node:process'
import { defineEventHandler, toWebRequest } from 'h3'
import { officeHomeSchema } from '../../shared'
import { readOfficeHome } from '../modules/transfers'
import { officeHomeHttpError } from './office-home/http'

/**
 * GET /api/office-home
 * One snapshot: the unassigned list, the waiting-on-acceptance list, the
 * in-progress list, the eight counts for the operational day that
 * contains now, and the failed work orders that still matter.
 * An unassigned row carries a decline alert for any day.
 * A dispatcher or an admin may read it. A driver is 403.
 * No session is 401. Another Tenant cannot: the tables have FORCE RLS.
 * The read writes nothing.
 */
/**
 * The office read uses the server clock. E2E pins that clock with this
 * header, and only while `NODE_ENV` is `test`. Production ignores it.
 */
function officeNow(headers: Headers): Date {
  if (process.env.NODE_ENV !== 'test')
    return new Date()
  const raw = headers.get('x-office-now')
  if (raw === null || raw === '')
    return new Date()
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime()))
    return new Date()
  return parsed
}

export default defineEventHandler(async (event) => {
  try {
    const headers = toWebRequest(event).headers
    return officeHomeSchema.parse(await readOfficeHome(headers, officeNow(headers)))
  }
  catch (error) {
    officeHomeHttpError(error)
  }
})
