import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { partnerSchema } from '../../../shared'
import { updatePartner } from '../../modules/partners'
import { parsePartnerId, partnerHttpError } from './http'

/**
 * PATCH /api/partners/:id
 * Correct the fields in the body. An unknown id in this Tenant is 404.
 * An archived Partner is 409. A body that matches the row writes nothing
 * and appends nothing.
 * Archive is POST /api/partners/:id/archive. Restore is POST /api/partners/:id/restore.
 */
export default defineEventHandler(async (event) => {
  const partnerId = parsePartnerId(getRouterParam(event, 'id'))
  try {
    return partnerSchema.parse(await updatePartner(toWebRequest(event).headers, partnerId, await readBody(event)))
  }
  catch (error) {
    partnerHttpError(error)
  }
})
