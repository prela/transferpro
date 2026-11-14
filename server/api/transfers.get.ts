import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { parseTransferListQuery, transferDaySchema } from '../../shared'
import { listTransferDay } from '../modules/transfers'
import { officeNow } from './office-now'
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
 * Transfer form. A removed contact person is left out. A handed-off Ride
 * also carries that Partner's phone and email. The note is not on it.
 * A driver is 403 before those reads (ADR-0049).
 * `filter=awaitingPartner` returns the handoffs waiting on Partner
 * confirmation whose pickup is not past, of any day. The query is
 * validated with `date` before a session opens.
 */
export default defineEventHandler(async (event) => {
  try {
    const headers = toWebRequest(event).headers
    const query = parseTransferListQuery(getQuery(event))
    return transferDaySchema.parse(await listTransferDay(
      headers,
      query.date ?? undefined,
      officeNow(headers),
      query.filter,
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
