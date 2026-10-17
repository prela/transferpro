import { isCompanySettingsPath } from '../../shared'

/**
 * The only admin check. An Admin stays. A signed-out visitor gets the
 * sign-in form. A Dispatcher or a Driver is sent away before the page loads:
 * company settings go to /profile, and any other admin address goes Home.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const nuxtApp = useNuxtApp()
  const lookup = await readTenantSession()
  if (lookup.kind === 'signed-out')
    return nuxtApp.runWithContext(() => navigateTo('/'))
  if (lookup.kind === 'unavailable')
    return
  if (lookup.session.role === 'admin')
    return
  // Profile is not a company-settings path, so this redirect cannot loop.
  const denied = isCompanySettingsPath(to.path) ? '/profile' : '/'
  return nuxtApp.runWithContext(() => navigateTo(denied))
})
