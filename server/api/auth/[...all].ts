import { defineEventHandler, toWebRequest } from 'h3'
import { handleAuthRequest } from '../../modules/tenancy'

/**
 * Better Auth. Sign-up is disabled in createAuth. Sign-in and sign-out
 * set the session cookie.
 */
export default defineEventHandler((event) => {
  return handleAuthRequest(toWebRequest(event))
})
