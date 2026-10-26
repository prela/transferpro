import type { APIRequestContext } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import { applyOfficeClaim, isOfficeWrite } from '../../shared'

export { expect }

/**
 * Playwright's API context does not go through the page's `$fetch`, so a
 * fixture write would otherwise omit the screen Tenant and be refused.
 * The claim is the session's current Tenant, which is what the old test
 * hatch meant. A browser save still uses the Tenant the screen opened with.
 */
function installOfficeClaim(request: APIRequestContext): void {
  const readSession = request.get.bind(request)
  const methods = ['post', 'put', 'patch', 'delete'] as const
  for (const method of methods) {
    const original = request[method].bind(request)
    const wrapped = async (url: string, options?: { data?: unknown, headers?: Record<string, string> }) => {
      if (!isOfficeWrite(method, url))
        return original(url, options)
      const session = await readSession('/api/session')
      const body: unknown = session.ok() ? await session.json() : undefined
      const tenantId = typeof body === 'object' && body !== null && 'tenantId' in body && typeof body.tenantId === 'string'
        ? body.tenantId
        : undefined
      if (tenantId === undefined)
        return original(url, options)
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
      return original(url, { ...options, headers, data: claimed.body })
    }
    Object.assign(request, { [method]: wrapped })
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    installOfficeClaim(page.request)
    await use(page)
  },
})
