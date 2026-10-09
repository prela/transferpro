/**
 * Transfers, Clients, Locations, Drivers, Vehicles, and Roster.
 * A Driver is sent Home before the page loads, so the browser does not
 * request that page's collection. A signed-out visitor gets the sign-in
 * form. Each page declares the dashboard layout. This middleware only
 * checks the session, because a layout call here is lost when two
 * sidebar navigations overlap. Not used on Home or settings.
 */
export default defineNuxtRouteMiddleware(async () => {
  const nuxtApp = useNuxtApp()
  const lookup = await readTenantSession()
  if (lookup.kind === 'signed-out')
    return nuxtApp.runWithContext(() => navigateTo('/'))
  // A 403 or a failed read stays on the page. Home is the only place that
  // sends a superadmin to the firm list.
  if (lookup.kind === 'unavailable')
    return
  if (lookup.session.role === 'driver')
    return nuxtApp.runWithContext(() => navigateTo('/'))
})
