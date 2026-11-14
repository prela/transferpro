import { nodeEnv } from '../core/index'

/**
 * The office read uses the server clock. Tests pin that clock with the
 * `x-office-now` header. Playwright drops a header added in `route.continue`,
 * so the e2e spec sends the same instant as the `tp-office-now` cookie.
 * Both are read only while `NODE_ENV` is `test`. Production ignores them.
 * `nodeEnv()` uses bracket access so Nitro does not inline `"production"`
 * into the built server Playwright starts.
 * Home and the awaiting-Partner filter share this clock, so a pinned
 * instant does not split the two reads.
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

export function officeNow(headers: Headers): Date {
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
