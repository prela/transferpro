import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { officeLocationSchema } from '../../../../shared'
import { archiveLocation } from '../../../modules/locations'
import { readOfficeBody } from '../../tenant-changed'
import { locationHttpError, parseLocationId } from '../http'

/**
 * POST /api/locations/:id/archive
 * Hide the Location from the default list. There is no delete.
 * A second archive writes nothing.
 */
export default defineEventHandler(async (event) => {
  const locationId = parseLocationId(getRouterParam(event, 'id'))
  try {
    return officeLocationSchema.parse(await archiveLocation(toWebRequest(event).headers, locationId, await readOfficeBody(event)))
  }
  catch (error) {
    locationHttpError(error)
  }
})
