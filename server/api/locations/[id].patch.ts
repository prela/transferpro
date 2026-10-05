import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { locationSchema } from '../../../shared'
import { updateLocation } from '../../modules/locations'
import { locationHttpError, parseLocationId } from './http'

/**
 * PATCH /api/locations/:id
 * Correct the fields in the body. An unknown id in this Tenant is 404.
 * A body that matches the row writes nothing and appends nothing.
 * Archive is POST /api/locations/:id/archive.
 */
export default defineEventHandler(async (event) => {
  const locationId = parseLocationId(getRouterParam(event, 'id'))
  try {
    return locationSchema.parse(await updateLocation(toWebRequest(event).headers, locationId, await readBody(event)))
  }
  catch (error) {
    locationHttpError(error)
  }
})
