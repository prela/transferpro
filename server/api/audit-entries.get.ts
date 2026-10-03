import { defineEventHandler, toWebRequest } from 'h3'
import { readAuditLog } from '../modules/tenancy'
import { memberHttpError } from './members/http'

/**
 * GET /api/audit-entries
 * The current Tenant's audit entries, newest first. Admin only; a dispatcher
 * or a driver gets 403. The same fixed phrases as the member routes.
 */
export default defineEventHandler(async (event) => {
  try {
    return await readAuditLog(toWebRequest(event).headers)
  }
  catch (error) {
    memberHttpError(error)
  }
})
