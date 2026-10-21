import { isPlatformTenantsPath } from '../../shared'

/**
 * Platform screens. A missing session is the login page.
 * useRequestFetch forwards the cookie on the document request; bare $fetch
 * would look unsigned during SSR and bounce a signed-in owner out.
 * The path check keeps this middleware idle if a page outside the firm
 * screens ever names it. Letter case is part of that check: `/Admin/tenants`
 * is the same screen.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!isPlatformTenantsPath(to.path))
    return
  try {
    await useRequestFetch()('/api/platform/session')
  }
  catch (error) {
    if (httpStatus(error) === 401)
      return navigateTo('/')
  }
})

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null)
    return undefined
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  if ('status' in error && typeof error.status === 'number')
    return error.status
  return undefined
}
