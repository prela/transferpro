import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { locationSchema } from '../../../../shared'
import { archiveLocation } from '../../../modules/locations'
import { locationHttpError, parseLocationId } from '../http'

/**
 * POST /api/locations/:id/archive
 * Hide the Location from the default list. There is no delete.
 * A second archive writes nothing.
 */
export default defineEventHandler(async (event) => {
  const locationId = parseLocationId(getRouterParam(event, 'id'))
  try {
    return locationSchema.parse(await archiveLocation(toWebRequest(event).headers, locationId))
  }
  catch (error) {
    locationHttpError(error)
  }
})
