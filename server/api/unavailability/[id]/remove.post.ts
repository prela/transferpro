import { defineEventHandler, getRouterParam, setResponseStatus, toWebRequest } from 'h3'
import { removeUnavailability } from '../../../modules/transfers'
import { readOfficeBody } from '../../tenant-changed'
import { unavailabilityHttpError } from '../http'

/**
 * POST /api/unavailability/:id/remove
 * Mark a window removed; it no longer counts. There is no delete: the
 * daily job deletes windows 90 days after they end. A removed or unknown
 * window is 404. The answer has no body.
 */
export default defineEventHandler(async (event) => {
  try {
    await removeUnavailability(toWebRequest(event).headers, getRouterParam(event, 'id'), await readOfficeBody(event))
    setResponseStatus(event, 204)
    return null
  }
  catch (error) {
    unavailabilityHttpError(error)
  }
})
