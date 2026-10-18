import { defineEventHandler, getQuery, setResponseHeader, toWebRequest } from 'h3'
import { exportRides } from '../../modules/transfers'
import { transferHttpError } from './http'

/**
 * GET /api/transfers/export?from=&to=
 * A CSV of every Ride whose pickup falls on those calendar days in the
 * Tenant time zone. A dispatcher or an admin may read them. A driver is
 * 403. No session is 401. A reversed range, a non-date, or more than 366
 * days is 400 before a session opens. The body is the file. Nothing is audited.
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const file = await exportRides(toWebRequest(event).headers, { from: query.from, to: query.to })
    setResponseHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setResponseHeader(event, 'content-disposition', `attachment; filename="${file.filename}"`)
    setResponseHeader(event, 'cache-control', 'no-store')
    return file.body
  }
  catch (error) {
    transferHttpError(error)
  }
})
