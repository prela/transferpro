import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { partnerListSchema } from '../../shared'
import { listPartners } from '../modules/partners'
import { parseIncludeArchived, partnerHttpError } from './partners/http'

/**
 * GET /api/partners
 * This Tenant's Partners. A dispatcher or an admin may read them. A driver
 * is 403. No session is 401. Another Tenant cannot: the table has FORCE RLS.
 * Archived rows are omitted unless includeArchived=true.
 */
export default defineEventHandler(async (event) => {
  try {
    const includeArchived = parseIncludeArchived(getQuery(event).includeArchived)
    return partnerListSchema.parse(await listPartners(toWebRequest(event).headers, includeArchived))
  }
  catch (error) {
    partnerHttpError(error)
  }
})
