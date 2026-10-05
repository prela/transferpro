import { nodeEnv } from '../../core/index'

/**
 * Deliberate fault for manual Sentry verification. Unavailable in production.
 */
export default defineEventHandler(() => {
  if (nodeEnv() === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  throw new Error('Deliberate Sentry test error')
})
