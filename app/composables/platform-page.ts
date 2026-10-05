import type { PlatformShell } from '../../shared'
import { platformShellSchema } from '../../shared'

/**
 * The platform screens call `/api/platform/session` only.
 * A 401 goes back to sign-in. A 403 is the ordinary no-access state.
 * Locale is applied in the browser: POST /api/locale opens a tenant session,
 * which a superadmin cannot mint.
 */
export async function usePlatformPage() {
  const { t, locale, setLocale } = useI18n()
  const requestFetch = useRequestFetch()
  const pending = ref(false)
  const shellError = ref<'shell.signOutFailed' | null>(null)

  const { data: shell, error: loadError } = await useAsyncData('platform-shell', async () => {
    try {
      return platformShellSchema.parse(await requestFetch<unknown>('/api/platform/session'))
    }
    catch (error) {
      // Same as the tenant screens: 401 is "signed out", not a load failure.
      // navigateTo inside this fetcher throws during the document request
      // (NUXT_E1001) and leaves the error + Sign out chrome on the page.
      if (httpStatus(error) === 401)
        return null
      throw error
    }
  })

  if (shell.value)
    await setLocale(shell.value.locale)

  async function signOut() {
    pending.value = true
    shellError.value = null
    try {
      // ofetch omits Content-Type when there is no body. The auth route still
      // gives that POST a body stream, and Better Auth answers 415. An empty
      // object is application/json, which sign-out accepts.
      await $fetch('/api/auth/sign-out', { method: 'POST', body: {} })
      clearNuxtData()
      await navigateTo('/')
    }
    catch {
      shellError.value = 'shell.signOutFailed'
    }
    finally {
      pending.value = false
    }
  }

  async function chooseLocale(next: PlatformShell['locale']) {
    await setLocale(next)
  }

  const loadMessage = computed(() => {
    if (shellError.value)
      return shellError.value
    if (httpStatus(loadError.value) === 403)
      return 'shell.noAccess'
    return 'shell.unavailable'
  })

  return { t, locale, shell, loadError, pending, shellError, signOut, chooseLocale, loadMessage }
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
