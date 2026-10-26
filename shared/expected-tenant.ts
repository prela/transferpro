/** JSON `code` when an office write was opened for a different Tenant than the session. */
export const TENANT_CHANGED = 'tenant_changed'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * Office form writes that must send the Tenant the screen was opened for.
 * The handlers that are not here are named in `officeWriteExemptions`, with
 * a reason. A unit test fails when a new write file is in neither place.
 */
const officeWrites: ReadonlyArray<{ readonly method: string, readonly pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/transfers$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/transfers/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/rides/${uuid}/(?:assign|accept|accept-by-phone|done|no-show|cancel|decline|landing|vehicle|clear|reassign|hand-off|partner|take-back)$`, 'i') },
  { method: 'POST', pattern: /^\/api\/clients$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/clients/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/clients/${uuid}/contact-persons$`, 'i') },
  { method: 'PATCH', pattern: new RegExp(`^/api/clients/${uuid}/contact-persons/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/clients/${uuid}/contact-persons/${uuid}/remove$`, 'i') },
  { method: 'PUT', pattern: new RegExp(`^/api/clients/${uuid}/note$`, 'i') },
  { method: 'POST', pattern: /^\/api\/partners$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/partners/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/partners/${uuid}/(?:archive|restore)$`, 'i') },
  { method: 'POST', pattern: /^\/api\/locations$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/locations/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/locations/${uuid}/archive$`, 'i') },
  { method: 'POST', pattern: /^\/api\/drivers$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/drivers/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/drivers/${uuid}/(?:archive|unarchive)$`, 'i') },
  { method: 'POST', pattern: /^\/api\/vehicles$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/vehicles/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/vehicles/${uuid}/archive$`, 'i') },
  { method: 'PUT', pattern: /^\/api\/roster$/ },
  { method: 'POST', pattern: /^\/api\/unavailability$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/unavailability/${uuid}$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/unavailability/${uuid}/remove$`, 'i') },
  { method: 'PATCH', pattern: /^\/api\/tenant-settings$/ },
  { method: 'DELETE', pattern: new RegExp(`^/api/members/${uuid}$`, 'i') },
  { method: 'PATCH', pattern: new RegExp(`^/api/members/${uuid}/role$`, 'i') },
  { method: 'POST', pattern: /^\/api\/invitations$/ },
  { method: 'POST', pattern: new RegExp(`^/api/invitations/${uuid}/revoke$`, 'i') },
  { method: 'POST', pattern: new RegExp(`^/api/office-home/failed-mail/${uuid}/resend$`, 'i') },
]

/**
 * Write handlers that must not carry the screen Tenant. Kept beside
 * `officeWrites` so a new route is classified in this file, not in the test.
 * Each reason is one line: why a missing claim is not a stale screen.
 */
const officeWriteExemptions: ReadonlyArray<{ readonly method: string, readonly pattern: RegExp, readonly reason: string }> = [
  { method: 'POST', pattern: /^\/api\/tenant-switch$/, reason: 'Switching the active Tenant is how the session Tenant changes.' },
  { method: 'POST', pattern: /^\/api\/tenant-choices$/, reason: 'Choosing a company is how a session with none becomes an office.' },
  { method: 'POST', pattern: /^\/api\/locale$/, reason: 'The locale is stored on the account, not on the office screen.' },
  { method: 'POST', pattern: /^\/api\/invitations\/accept$/, reason: 'Accepting an invitation is how a person joins, before an office screen exists.' },
  { method: 'POST', pattern: /^\/api\/invitations\/preview$/, reason: 'Preview is a public read of one invitation, posted so the id stays out of the query.' },
  { method: 'POST', pattern: /^\/api\/locations\/suggestions$/, reason: 'Address suggestions do not write a Tenant row.' },
  { method: 'POST', pattern: /^\/api\/locations\/embed-mode$/, reason: 'Test-only switch for the fake map embed. Any other environment is 404.' },
  { method: 'POST', pattern: /^\/api\/locations\/suggestions-mode$/, reason: 'Test-only switch for address suggestions. Any other environment is 404.' },
  { method: 'PATCH', pattern: new RegExp(`^/api/platform/tenants/${uuid}$`, 'i'), reason: 'Platform rename has no office Tenant. The actor is a superadmin.' },
]

function requestPath(url: string): string {
  return (url.startsWith('http://') || url.startsWith('https://') ? new URL(url).pathname : url.split('?')[0]) ?? ''
}

function matches(rules: ReadonlyArray<{ readonly method: string, readonly pattern: RegExp }>, method: string, url: string): boolean {
  const path = requestPath(url)
  const verb = method.toUpperCase()
  return rules.some(rule => rule.method === verb && rule.pattern.test(path))
}

/** True when this request is an office write that must name its screen Tenant. */
export function isOfficeWrite(method: string, url: string): boolean {
  return matches(officeWrites, method, url)
}

/**
 * The one-line reason this write is not an office write, or undefined when
 * the route is an office write or unknown. The guard test requires one or
 * the other for every handler file.
 */
export function officeWriteExemption(method: string, url: string): string | undefined {
  const path = requestPath(url)
  const verb = method.toUpperCase()
  return officeWriteExemptions.find(rule => rule.method === verb && rule.pattern.test(path))?.reason
}

export interface OfficeClaimRequest {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly body: unknown
}

export interface OfficeClaimResult {
  readonly claimed: boolean
  readonly headers: Headers
  readonly body: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A JSON string gains the claim. Anything else keeps the header only. */
function claimBody(body: unknown, tenantId: string): unknown {
  if (body == null)
    return { expectedTenantId: tenantId }
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body)
      if (isRecord(parsed))
        return JSON.stringify({ ...parsed, expectedTenantId: tenantId })
    }
    catch {
      // A body that is not JSON still sends the header.
    }
    return body
  }
  if (isRecord(body))
    return { ...body, expectedTenantId: tenantId }
  return body
}

/**
 * Header plus JSON body for an office write. Other requests are unchanged,
 * so a tenant switch or a sign-in does not grow an unknown key.
 * The caller passes the Tenant the screen was opened for.
 */
export function applyOfficeClaim(request: OfficeClaimRequest, tenantId: string): OfficeClaimResult {
  if (!isOfficeWrite(request.method, request.url))
    return { claimed: false, headers: request.headers, body: request.body }
  const headers = new Headers(request.headers)
  headers.set('x-expected-tenant-id', tenantId)
  return { claimed: true, headers, body: claimBody(request.body, tenantId) }
}
