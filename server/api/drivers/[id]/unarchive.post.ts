import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { driverSchema } from '../../../../shared'
import { unarchiveDriver } from '../../../modules/drivers'
import { readOfficeBody } from '../../tenant-changed'
import { driverHttpError, parseDriverId } from '../http'

/**
 * POST /api/drivers/:id/unarchive
 * Put the Driver back on the default list. A Driver who is already there
 * writes nothing.
 */
export default defineEventHandler(async (event) => {
  const driverId = parseDriverId(getRouterParam(event, 'id'))
  try {
    return driverSchema.parse(await unarchiveDriver(toWebRequest(event).headers, driverId, await readOfficeBody(event)))
  }
  catch (error) {
    driverHttpError(error)
  }
})
