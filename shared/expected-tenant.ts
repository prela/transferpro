/** JSON `code` when an office write was opened for a different Tenant than the session. */
export const TENANT_CHANGED = 'tenant_changed'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * Office form writes that must send the Tenant the screen was opened for.
 * Tenant switch, tenant choice, locale, auth, invitation accept, and reads
 * are absent on purpose: those are how the session's Tenant changes, or
 * they do not write.
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
]

/** True when this request is an office write that must name its screen Tenant. */
export function isOfficeWrite(method: string, url: string): boolean {
  const path = (url.startsWith('http://') || url.startsWith('https://') ? new URL(url).pathname : url.split('?')[0]) ?? ''
  const verb = method.toUpperCase()
  return officeWrites.some(rule => rule.method === verb && rule.pattern.test(path))
}
