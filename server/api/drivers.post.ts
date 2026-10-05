import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { driverSchema } from '../../shared'
import { createDriver } from '../modules/drivers'
import { driverHttpError } from './drivers/http'

/**
 * POST /api/drivers
 * A dispatcher or an admin adds a Driver. An invalid body is 400 and is
 * parsed before a session opens. A driver is 403. No session is 401.
 * The response is the row. The audit entry written with it does not contain the phone.
 */
export default defineEventHandler(async (event) => {
  try {
    return driverSchema.parse(await createDriver(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    driverHttpError(error)
  }
})
