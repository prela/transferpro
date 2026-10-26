import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { partnerSchema } from '../../../../shared'
import { restorePartner } from '../../../modules/partners'
import { readOfficeBody } from '../../tenant-changed'
import { parsePartnerId, partnerHttpError } from '../http'

/**
 * POST /api/partners/:id/restore
 * Put the Partner back on the default list. A Partner who is already there
 * writes nothing.
 */
export default defineEventHandler(async (event) => {
  const partnerId = parsePartnerId(getRouterParam(event, 'id'))
  try {
    return partnerSchema.parse(await restorePartner(toWebRequest(event).headers, partnerId, await readOfficeBody(event)))
  }
  catch (error) {
    partnerHttpError(error)
  }
})
