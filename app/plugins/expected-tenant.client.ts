import type { OfficeClaimRequest } from '../../shared'
import { applyOfficeClaim, TENANT_CHANGED } from '../../shared'
import { screenTenantIdKey, tenantChangedKey } from '../composables/screen-tenant'
import { sessionShellKey } from '../composables/session-shell'

/**
 * A later poll can see a company switched in another tab. The form must
 * still name the company it was opened for (issue #506).
 *
 * `$fetch.create` adds the claim before ofetch serialises the body. The
 * fetch function is read at call time, so the tenant-switch hold (which
 * replaces `window.fetch` only while a switch is in progress) still
 * applies. Nothing patches `window.fetch` at startup, and there is no
 * inline script for a Content-Security-Policy to block.
 */

const reloadKey = 'transferpro-tenant-changed'

/** Long enough for the message to be read and for the a11y check to run. */
const RELOAD_MS = 3_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathname(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://'))
    return new URL(url).pathname
  return url.split('?')[0] ?? url
}

async function responsePayload(response: Response & { _data?: unknown }): Promise<unknown> {
  if (response._data !== undefined)
    return response._data
  return response.clone().json().catch(() => undefined)
}

function requestUrl(request: RequestInfo): string {
  if (typeof request === 'string')
    return request
  if (request instanceof URL)
    return request.href
  return request.url
}

export default defineNuxtPlugin({
  name: 'expected-tenant',
  enforce: 'pre',
  setup() {
    const screenTenantId = useState<string | null>(screenTenantIdKey, () => null)
    const visible = useState(tenantChangedKey, () => false)
    const shell = useNuxtData<{ tenantId?: string } | null>(sessionShellKey)

    // First id wins. useNuxtData does not track a session ref created later,
    // so the session response below is what freezes the id for a client sign-in.
    // A poll after a switch must not retarget the form.
    function rememberTenant(tenantId: unknown) {
      if (screenTenantId.value === null && typeof tenantId === 'string' && tenantId !== '')
        screenTenantId.value = tenantId
    }
    rememberTenant(shell.data.value?.tenantId)

    if (sessionStorage.getItem(reloadKey) === 'show') {
      visible.value = true
      sessionStorage.removeItem(reloadKey)
    }

    let reloadArmed = false
    function showTenantChanged() {
      visible.value = true
      if (reloadArmed || sessionStorage.getItem(reloadKey) === 'pending')
        return
      reloadArmed = true
      sessionStorage.setItem(reloadKey, 'pending')
      window.setTimeout(() => {
        sessionStorage.setItem(reloadKey, 'show')
        window.location.assign('/')
      }, RELOAD_MS)
    }

    // Nuxt's `$fetch.create` type lists one argument. ofetch accepts a second
    // one, and that is where the fetch implementation lives. Passing it here
    // keeps Nuxt's defaults and reads `window.fetch` on each call.
    const createOfficeFetch = $fetch.create as (
      defaults: Parameters<typeof $fetch.create>[0],
      globalOptions: { fetch: typeof globalThis.fetch },
    ) => typeof globalThis.$fetch
    const officeFetch = createOfficeFetch({
      onRequest({ request, options }) {
        const tenantId = screenTenantId.value
        if (tenantId === null)
          return
        const claimed = applyOfficeClaim({
          method: options.method ?? 'GET',
          url: requestUrl(request),
          headers: options.headers,
          body: options.body,
        } satisfies OfficeClaimRequest, tenantId)
        if (!claimed.claimed)
          return
        options.headers = claimed.headers
        options.body = claimed.body as typeof options.body
      },
      async onResponse({ request, response }) {
        const url = requestUrl(request)
        const data = await responsePayload(response)
        if (screenTenantId.value === null && pathname(url) === '/api/session' && response.ok && isRecord(data))
          rememberTenant(data.tenantId)
        if (response.status === 409 && isRecord(data) && data.code === TENANT_CHANGED)
          showTenantChanged()
      },
    }, {
      fetch: (input, init) => globalThis.fetch(input, init),
    })

    globalThis.$fetch = officeFetch
  },
})
