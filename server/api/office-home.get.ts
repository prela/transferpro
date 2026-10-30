import { defineEventHandler, toWebRequest } from 'h3'
import { officeHomeSchema } from '../../shared'
import { nodeEnv } from '../core/index'
import { readOfficeHome } from '../modules/transfers'
import { officeHomeHttpError } from './office-home/http'

/**
 * GET /api/office-home
 * One snapshot: the unassigned list, the waiting-on-acceptance list, the
 * in-progress list, the eight counts for the operational day that
 * contains now, and the failed work orders that still matter.
 * An unassigned row carries a decline alert for any day.
 * A dispatcher or an admin may read it. A driver is 403.
 * No session is 401. Another Tenant cannot: the tables have FORCE RLS.
 * The read writes nothing.
 */
/**
 * The office read uses the server clock. Tests pin that clock with the
 * `x-office-now` header. Playwright drops a header added in `route.continue`,
 * so the e2e spec sends the same instant as the `tp-office-now` cookie.
 * Both are read only while `NODE_ENV` is `test`. Production ignores them.
 * `nodeEnv()` uses bracket access so Nitro does not inline `"production"`
 * into the built server Playwright starts.
 */
const officeNowCookie = 'tp-office-now'

/** Header first, then the cookie the e2e browser can actually send. */
function pinnedOfficeInstant(headers: Headers): string | null {
  const header = headers.get('x-office-now')
  if (header !== null && header !== '')
    return header
  const cookie = headers.get('cookie')
  if (cookie === null)
    return null
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    const prefix = `${officeNowCookie}=`
    if (!trimmed.startsWith(prefix))
      continue
    return decodeURIComponent(trimmed.slice(prefix.length))
  }
  return null
}

function officeNow(headers: Headers): Date {
  if (nodeEnv() !== 'test')
    return new Date()
  const raw = pinnedOfficeInstant(headers)
  if (raw === null || raw === '')
    return new Date()
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime()))
    return new Date()
  return parsed
}

export default defineEventHandler(async (event) => {
  try {
    const headers = toWebRequest(event).headers
    return officeHomeSchema.parse(await readOfficeHome(headers, officeNow(headers)))
  }
  catch (error) {
    officeHomeHttpError(error)
  }
})
