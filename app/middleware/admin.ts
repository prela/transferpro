/**
 * The only admin check. An Admin stays. A signed-out visitor gets the
 * sign-in form. A Dispatcher or a Driver is sent away before the page loads:
 * Tenant settings and Members go to Profile, and any other admin address
 * goes Home. Audit will use that Home branch.
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
  const denied = isSettingsAdminPath(to.path) ? '/settings/profile' : '/'
  return nuxtApp.runWithContext(() => navigateTo(denied))
})

/** Tenant and Members. Profile is not one of these, so the redirect cannot loop. */
function isSettingsAdminPath(path: string) {
  const bare = path.replace(/\/$/, '') || '/'
  return bare === '/settings/tenant' || bare === '/settings/members'
}
