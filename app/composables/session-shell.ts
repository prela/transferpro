import type { SessionShell } from '../../shared'
import { platformShellSchema, sessionShellSchema } from '../../shared'

/**
 * Payload key for the signed-in Tenant shell.
 * Home and the office pages share this entry. `MemberInvite` refreshes it on 401.
 */
const sessionShellKey = 'session-shell'

interface SessionShellOptions {
  /** Office pages send a signed-out visitor to the sign-in form. Home does not. */
  redirectWhenSignedOut?: boolean
}

/**
 * Home and the office pages read one shell: Tenant id, Tenant name, user id,
 * Locale, time zone, and role. A successful sign-out clears it before the next
 * paint, so the next screen cannot show the previous Tenant, and the signed-out
 * screen returns to Croatian. A failed sign-out leaves the shell in place.
 * The device theme (`transferpro-theme`) is not touched.
 */
export async function useSessionShell(options?: SessionShellOptions) {
  const { t, setLocale } = useI18n()
  const requestFetch = useRequestFetch()
  const route = useRoute()
  const pending = ref(false)
  const shellError = ref<'shell.saveFailed' | 'shell.signOutFailed' | null>(null)
  // Shared across pages. The first caller owns the async-data handler, and a
  // later refresh (sign-in on Home) still has to see this flag.
  const platformRedirect = useState('session-platform-redirect', () => false)

  const { data: session, error: loadError, refresh } = await useAsyncData(sessionShellKey, loadShell, {
    // Hydration has to paint the shell the server rendered. After that, do not
    // reuse a cached null: a superadmin's next visit to Home would see sign-in.
    getCachedData: (key, nuxtApp) => nuxtApp.isHydrating ? nuxtApp.payload.data[key] : undefined,
  })

  if (session.value)
    await setLocale(session.value.locale)
  else if (options?.redirectWhenSignedOut && !loadError.value)
    await navigateTo('/')

  async function loadShell(): Promise<SessionShell | null> {
    platformRedirect.value = false
    try {
      return sessionShellSchema.parse(await requestFetch<unknown>('/api/session'))
    }
    catch (error) {
      if (httpStatus(error) === 401)
        return null
      // 200 stays on this page. 403 then a platform session goes to the firm list.
      // Office pages keep the no-access state: the firm list is only from Home.
      if (httpStatus(error) === 403 && route.path === '/' && await hasPlatformSession()) {
        platformRedirect.value = true
        await navigateTo('/admin/tenants')
        return null
      }
      throw error
    }
  }

  async function hasPlatformSession(): Promise<boolean> {
    try {
      platformShellSchema.parse(await requestFetch<unknown>('/api/platform/session'))
      return true
    }
    catch (error) {
      if (httpStatus(error) === 401 || httpStatus(error) === 403)
        return false
      throw error
    }
  }

  async function signOut() {
    pending.value = true
    shellError.value = null
    try {
      // ofetch omits Content-Type when there is no body. The auth route still
      // gives that POST a body stream, and Better Auth answers 415. An empty
      // object is application/json, which sign-out accepts.
      await $fetch('/api/auth/sign-out', { method: 'POST', body: {} })
      // The cookie is gone. Drop the shared shell before the next paint so
      // this page and the next one cannot render the previous Tenant. A
      // refetch would leave that Tenant up until the response arrived.
      clearSharedShell()
      await setLocale('hr')
      if (route.path !== '/')
        await navigateTo('/')
    }
    catch {
      // A failed request keeps the shell. A throw after the shell was cleared
      // (locale or navigation) is not the sign-out failure message.
      if (session.value)
        shellError.value = 'shell.signOutFailed'
    }
    finally {
      pending.value = false
    }
  }

  function clearSharedShell() {
    const nuxtApp = useNuxtApp()
    const entry = nuxtApp._asyncData[sessionShellKey]
    // Abort a refresh that is still in flight. A late resolve writes the
    // Tenant back unless this promise slot is empty when it lands.
    entry?._abortController?.abort(new DOMException('Session shell cleared on sign-out.', 'AbortError'))
    delete nuxtApp._asyncDataPromises[sessionShellKey]
    session.value = null
    loadError.value = undefined
    if (entry) {
      // Stay successful so the next page paints this empty shell. Idle would
      // suspend that page on a refetch, and the previous Tenant could remain
      // on screen until the response arrived. Pending follows this status.
      entry.status.value = 'success'
    }
    // useNuxtData reads `data ?? payload`. Null would fall through to the
    // payload copy, which still holds the previous Tenant.
    delete nuxtApp.payload.data[sessionShellKey]
  }

  async function chooseLocale(next: SessionShell['locale']) {
    shellError.value = null
    if (!session.value) {
      await setLocale(next)
      return
    }
    try {
      await $fetch('/api/locale', {
        method: 'POST',
        body: { locale: next },
      })
      await refresh()
      await setLocale(session.value?.locale ?? next)
    }
    catch {
      shellError.value = 'shell.saveFailed'
    }
  }

  // No membership is 403 (ADR-0011). Any other load failure stays a retry.
  const loadMessage = computed(() => {
    if (shellError.value)
      return shellError.value
    if (httpStatus(loadError.value) === 403)
      return 'shell.noAccess'
    return 'shell.unavailable'
  })

  return {
    t,
    setLocale,
    session,
    loadError,
    refresh,
    pending,
    shellError,
    signOut,
    chooseLocale,
    loadMessage,
    platformRedirect,
  }
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}
