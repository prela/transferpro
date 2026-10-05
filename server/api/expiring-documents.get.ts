import { defineEventHandler, toWebRequest } from 'h3'
import { expiringDocumentListSchema } from '../../shared'
import { listExpiringDocuments } from '../modules/expiring-documents'
import { expiringDocumentsHttpError } from './expiring-documents/http'

/**
 * GET /api/expiring-documents
 * Driver and Vehicle documents that are expired or due within 30 calendar
 * days, in the Tenant time zone. Admin and dispatcher see the office list.
 * A driver sees only their linked Driver's licences. No session is 401.
 * Another Tenant cannot: both tables have FORCE RLS. Nothing is written.
 */
export default defineEventHandler(async (event) => {
  try {
    return expiringDocumentListSchema.parse(await listExpiringDocuments(toWebRequest(event).headers))
  }
  catch (error) {
    expiringDocumentsHttpError(error)
  }
})
