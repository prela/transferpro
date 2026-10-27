import { createError, defineEventHandler, readBody, setCookie } from 'h3'
import { z } from 'zod'
import { nodeEnv } from '../../core/index'
import { TEST_SUGGESTIONS_UNAVAILABLE_COOKIE } from '../../modules/locations'

/**
 * POST /api/locations/suggestions-mode
 * Test and E2E tell the fake adapter to answer unavailable for this caller.
 * The mark is a cookie, because e2e workers share one server process.
 * Any other environment is 404, so this cannot switch a real provider.
 */
export default defineEventHandler(async (event) => {
  if (nodeEnv() !== 'test')
    throw createError({ statusCode: 404 })
  const parsed = z.strictObject({ unavailable: z.boolean() }).safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  setCookie(event, TEST_SUGGESTIONS_UNAVAILABLE_COOKIE, parsed.data.unavailable ? '1' : '0', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  })
  return { unavailable: parsed.data.unavailable }
})
