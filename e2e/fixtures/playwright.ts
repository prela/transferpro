import type { APIRequestContext } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import { applyOfficeClaim, isOfficeWrite } from '../../shared'

export { expect }

const officeClaimInstalled = Symbol.for('transferpro.officeClaim')

/**
 * Playwright's API context does not go through the page's `$fetch`, so a
 * fixture write would otherwise omit the screen Tenant and be refused.
 * The claim is the session's current Tenant, which is what the old test
 * hatch meant. A browser save still uses the Tenant the screen opened with.
 *
 * The methods live on one prototype, so a second browser context (a colleague
 * signed in on another page) is covered too. Wrapping only `page.request`
 * leaves that context's writes without a claim, and the server refuses them.
 */
function installOfficeClaim(request: APIRequestContext): void {
  const proto = Object.getPrototypeOf(request) as APIRequestContext & { [officeClaimInstalled]?: boolean }
  if (proto[officeClaimInstalled])
    return
  proto[officeClaimInstalled] = true
  const methods = ['post', 'put', 'patch', 'delete'] as const
  for (const method of methods) {
    const original = proto[method]
    // Playwright's overloads are generic in the response body. The wrapper returns that same response.
    proto[method] = async function (this: APIRequestContext, url: string, options?: { data?: unknown, headers?: Record<string, string> }) {
      if (!isOfficeWrite(method, url))
        return original.call(this, url, options)
      const session = await this.get('/api/session')
      const body: unknown = session.ok() ? await session.json() : undefined
      const tenantId = typeof body === 'object' && body !== null && 'tenantId' in body && typeof body.tenantId === 'string'
        ? body.tenantId
        : undefined
      if (tenantId === undefined)
        return original.call(this, url, options)
      const claimed = applyOfficeClaim({
        method,
        url,
        headers: new Headers(options?.headers),
        body: options?.data,
      }, tenantId)
      const headers: Record<string, string> = {}
      claimed.headers.forEach((value, key) => {
        headers[key] = value
      })
      return original.call(this, url, { ...options, headers, data: claimed.body })
    } as typeof original
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    installOfficeClaim(page.request)
    await use(page)
  },
})
