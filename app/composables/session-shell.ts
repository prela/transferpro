import type { SessionShell } from '../../shared'
import { platformShellSchema, sessionShellSchema } from '../../shared'

/**
 * Payload key for the signed-in Tenant shell.
 * Home and the office pages share this entry. `MemberInvite` refreshes it on 401.
 */
const sessionShellKey = 'session-shell'

interface SessionShellOptions {
  /**
   * Office pages set this. The office middleware already sends a signed-out
   * visitor to the sign-in form, and a Driver Home, before the page loads.
   * If that read fails and this page then loads a Driver, the Driver still leaves.
   */
  redirectWhenSignedOut?: boolean
}

/**
 * What a route middleware learns from GET /api/session before the page loads.
 * 401 is signed out. Any other failure is left to the page: Home still sends
 * a superadmin to the firm list, and an office page still shows no-access.
 */
export type TenantSessionLookup
  = | { kind: 'member', session: SessionShell }
    | { kind: 'signed-out' }
    | { kind: 'unavailable' }

/** Admin and Dispatcher. A Driver is not an office member. */
export function isOfficeMember(role: SessionShell['role'] | undefined): boolean {
  return role === 'admin' || role === 'dispatcher'
}

/**
 * The route middlewares read the same shell as the pages.
 * `useRequestFetch` runs before the await so the document request forwards
 * the cookie. A bare `$fetch` during SSR would look signed out.
 */
export async function readTenantSession(): Promise<TenantSessionLookup> {
  const requestFetch = useRequestFetch()
  try {
    const session = sessionShellSchema.parse(await requestFetch<unknown>('/api/session'))
    return { kind: 'member', session }
  }
  catch (error) {
    if (httpStatus(error) === 401)
      return { kind: 'signed-out' }
    return { kind: 'unavailable' }
  }
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
  // The navbar menu and these pages share one sign-out. A failure sets the
  // alert already on the page; a success clears this shell.
  const { pending, shellError, signOut } = useShellSignOut()
  // Shared across pages. The first caller owns the async-data handler, and a
  // later refresh (sign-in on Home) still has to see this flag.
  const platformRedirect = useState('session-platform-redirect', () => false)
  // Await below leaves this composable without the Nuxt instance. The page
  // setup keeps it; a nested composable does not (NUXT_E1001 on a document request).
  const nuxtApp = useNuxtApp()

  const { data: session, error: loadError, refresh } = await useAsyncData(sessionShellKey, loadShell, {
    // Hydration has to paint the shell the server rendered. After that, do not
    // reuse a cached null: a superadmin's next visit to Home would see sign-in.
    getCachedData: (key, app) => app.isHydrating ? app.payload.data[key] : undefined,
  })

  const locale = session.value?.locale
  if (locale)
    await nuxtApp.runWithContext(() => setLocale(locale))
  else if (options?.redirectWhenSignedOut && !loadError.value)
    await nuxtApp.runWithContext(() => navigateTo('/'))
  // The middleware is the gate. This covers a Driver whose middleware read
  // failed and whose page read then succeeded.
  if (options?.redirectWhenSignedOut && session.value?.role === 'driver')
    await nuxtApp.runWithContext(() => navigateTo('/'))

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

type ShellError = 'shell.saveFailed' | 'shell.signOutFailed' | null

/**
 * Sign-out for the office navbar and for the pages that still have the button.
 * Pending and the failure live in shared state so the menu and the page alert
 * are one action. A route change drops the failure, which is what a fresh
 * page ref used to do. The device theme is not touched.
 */
export function useShellSignOut() {
  const { setLocale } = useI18n()
  const route = useRoute()
  const pending = useState('session-shell-pending', () => false)
  const shellError = useState<ShellError>('session-shell-error', () => null)
  const session = computed(readSharedSession)

  watch(() => route.path, () => {
    shellError.value = null
  })

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

  return { pending, shellError, signOut, session }
}

function readSharedSession(): SessionShell | null {
  const nuxtApp = useNuxtApp()
  const entry = nuxtApp._asyncData[sessionShellKey]
  // Prefer the live ref. Falling through on null would revive the payload copy.
  const value = entry ? entry.data.value : nuxtApp.payload.data[sessionShellKey]
  const parsed = sessionShellSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function clearSharedShell() {
  const nuxtApp = useNuxtApp()
  const entry = nuxtApp._asyncData[sessionShellKey]
  // Abort a refresh that is still in flight. A late resolve writes the
  // Tenant back unless this promise slot is empty when it lands.
  entry?._abortController?.abort(new DOMException('Session shell cleared on sign-out.', 'AbortError'))
  delete nuxtApp._asyncDataPromises[sessionShellKey]
  if (entry) {
    entry.data.value = null
    entry.error.value = undefined
    // Stay successful so the next page paints this empty shell. Idle would
    // suspend that page on a refetch, and the previous Tenant could remain
    // on screen until the response arrived. Pending follows this status.
    entry.status.value = 'success'
  }
  // useNuxtData reads `data ?? payload`. Null would fall through to the
  // payload copy, which still holds the previous Tenant.
  delete nuxtApp.payload.data[sessionShellKey]
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
