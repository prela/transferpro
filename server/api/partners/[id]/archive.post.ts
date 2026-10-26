import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { partnerSchema } from '../../../../shared'
import { archivePartner } from '../../../modules/partners'
import { readOfficeBody } from '../../tenant-changed'
import { parsePartnerId, partnerHttpError } from '../http'

/**
 * POST /api/partners/:id/archive
 * Hide the Partner from the default list. There is no delete.
 * A second archive writes nothing.
 */
export default defineEventHandler(async (event) => {
  const partnerId = parsePartnerId(getRouterParam(event, 'id'))
  try {
    return partnerSchema.parse(await archivePartner(toWebRequest(event).headers, partnerId, await readOfficeBody(event)))
  }
  catch (error) {
    partnerHttpError(error)
  }
})
