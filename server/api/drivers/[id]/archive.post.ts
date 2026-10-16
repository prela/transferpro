import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { driverSchema } from '../../../../shared'
import { archiveDriver } from '../../../modules/drivers'
import { driverHttpError, parseDriverId } from '../http'

/**
 * POST /api/drivers/:id/archive
 * Hide the Driver from the default list and from a new assignment.
 * There is no delete. A second archive writes nothing.
 */
export default defineEventHandler(async (event) => {
  const driverId = parseDriverId(getRouterParam(event, 'id'))
  try {
    return driverSchema.parse(await archiveDriver(toWebRequest(event).headers, driverId))
  }
  catch (error) {
    driverHttpError(error)
  }
})
