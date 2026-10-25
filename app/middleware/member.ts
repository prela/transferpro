/**
 * /profile. Every Tenant role may open it, the Driver included. A signed-out
 * visitor gets the sign-in form. A session that still has to choose a
 * Tenant goes to the gate. The page repeats this check: a caller that
 * skips the middleware still cannot render the account.
 */
export default defineNuxtRouteMiddleware(async () => {
  const nuxtApp = useNuxtApp()
  const lookup = await readTenantSession()
  if (lookup.kind === 'signed-out' || lookup.kind === 'choose-tenant')
    return nuxtApp.runWithContext(() => navigateTo('/'))
  // A 403 (no membership) or a failed read stays. The page shows no-access
  // and does not paint the account.
  if (lookup.kind === 'unavailable')
    return
  const office = isOfficeMember(lookup.session.role)
  await nuxtApp.runWithContext(() => setPageLayout(office ? 'dashboard' : 'default'))
})
