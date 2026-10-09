/**
 * The only admin check. An Admin stays. A Dispatcher or a Driver is sent
 * Home before the page loads. A signed-out visitor gets the sign-in form.
 * No route declares this yet.
 */
export default defineNuxtRouteMiddleware(async () => {
  const nuxtApp = useNuxtApp()
  const lookup = await readTenantSession()
  if (lookup.kind === 'signed-out')
    return nuxtApp.runWithContext(() => navigateTo('/'))
  if (lookup.kind === 'unavailable')
    return
  if (lookup.session.role !== 'admin')
    return nuxtApp.runWithContext(() => navigateTo('/'))
})
