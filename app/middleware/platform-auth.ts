/**
 * Platform screens. A missing session is the login page.
 * useRequestFetch forwards the cookie on the document request; bare $fetch
 * would look unsigned during SSR and bounce a signed-in owner out.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin/tenants'))
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
