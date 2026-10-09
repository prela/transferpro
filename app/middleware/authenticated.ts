/**
 * Layout for Home and settings. An Admin or a Dispatcher gets the dashboard
 * layout. A Driver and a signed-out visitor stay on the default phone layout.
 * This does not redirect: Home still shows the sign-in form, and a superadmin
 * still leaves Home for the firm list from the session shell. Settings sends
 * a signed-out visitor to that form itself, because this middleware also
 * serves Home.
 */
export default defineNuxtRouteMiddleware(async () => {
  const nuxtApp = useNuxtApp()
  const lookup = await readTenantSession()
  const office = lookup.kind === 'member' && isOfficeMember(lookup.session.role)
  // After the session fetch the middleware may no longer hold the Nuxt instance.
  await nuxtApp.runWithContext(() => setPageLayout(office ? 'dashboard' : 'default'))
})
