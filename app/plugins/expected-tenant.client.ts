import { isOfficeWrite, TENANT_CHANGED } from '../../shared'
import { screenTenantIdKey, tenantChangedKey } from '../composables/screen-tenant'
import { sessionShellKey } from '../composables/session-shell'

/**
 * A later poll can see a company switched in another tab. The form must
 * still name the company it was opened for (issue #506).
 *
 * Nuxt binds `$fetch` before plugins run. ofetch has already captured
 * `window.fetch`, so this plugin does not replace it. The inline script in
 * `nuxt.config` captured the original and calls the hook installed here.
 */

interface TransferproFetchHook {
  (input: RequestInfo | URL, init: RequestInit | undefined, native: typeof fetch): Promise<Response>
}

declare global {
  interface Window {
    __transferproFetch?: TransferproFetchHook
  }
}

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

/** The claim rides in the JSON body as well as the header. A non-JSON body keeps the header only. */
function mergeClaim(body: string, tenantId: string): string {
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

    window.__transferproFetch = async (input, init, native) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const url = input instanceof Request ? input.url : String(input)
      const tenantId = screenTenantId.value
      if (tenantId !== null && isOfficeWrite(method, url)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        headers.set('x-expected-tenant-id', tenantId)
        const next: RequestInit = init ?? {}
        next.headers = headers
        if (typeof next.body === 'string')
          next.body = mergeClaim(next.body, tenantId)
        else if (next.body == null && !(input instanceof Request))
          next.body = JSON.stringify({ expectedTenantId: tenantId })
        init = next
      }
      const response = await native(input, init)
      if (screenTenantId.value === null && pathname(url) === '/api/session' && response.ok) {
        const data: unknown = await response.clone().json().catch(() => undefined)
        if (isRecord(data))
          rememberTenant(data.tenantId)
      }
      if (response.status === 409) {
        const data: unknown = await response.clone().json().catch(() => undefined)
        if (isRecord(data) && data.code === TENANT_CHANGED)
          showTenantChanged()
      }
      return response
    }
  },
})
