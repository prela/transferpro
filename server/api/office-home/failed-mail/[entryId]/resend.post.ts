import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { failedMailResendSchema } from '../../../../../shared'
import { resendFailedMail } from '../../../../modules/transfers'
import { officeHomeHttpError } from '../../http'

/**
 * POST /api/office-home/failed-mail/:entryId/resend
 * One immediate attempt for a failed work order. Admin and dispatcher only.
 * The route enforces that allow-list itself. No session is 401. A driver is 403.
 * A missing id, including another Tenant's, is 404. The body is empty.
 * Success removes the row from the failed list. A mail that no longer matters
 * is not sent and becomes stale. A rejection stays failed and does not start
 * a new retry cycle. Nothing is audited.
 */
export default defineEventHandler(async (event) => {
  const entryId = getRouterParam(event, 'entryId')
  let body: unknown = {}
  try {
    const read = await readBody(event)
    body = read === undefined || read === null || read === '' ? {} : read
  }
  catch {
    // Invalid JSON. The session still decides 401 and 403 before this becomes 400.
    body = { invalid: true }
  }
  try {
    return failedMailResendSchema.parse(await resendFailedMail(toWebRequest(event).headers, entryId, body))
  }
  catch (error) {
    officeHomeHttpError(error)
  }
})
