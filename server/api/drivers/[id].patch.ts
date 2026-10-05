import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { driverSchema } from '../../../shared'
import { updateDriver } from '../../modules/drivers'
import { driverHttpError, parseDriverId } from './http'

/**
 * PATCH /api/drivers/:id
 * Correct the fields in the body. An unknown id in this Tenant is 404.
 * A body that matches the row writes nothing and appends nothing.
 * Only an admin may change must-accept.
 */
export default defineEventHandler(async (event) => {
  const driverId = parseDriverId(getRouterParam(event, 'id'))
  try {
    return driverSchema.parse(await updateDriver(toWebRequest(event).headers, driverId, await readBody(event)))
  }
  catch (error) {
    driverHttpError(error)
  }
})
