import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { nodeEnv } from '../../core/index'
import { setTestMapsUnavailable } from '../../modules/locations'

/**
 * POST /api/locations/suggestions-mode
 * Test and E2E tell the fake adapter to answer unavailable. Any other
 * environment is 404, so this cannot switch a real provider.
 */
export default defineEventHandler(async (event) => {
  if (nodeEnv() !== 'test')
    throw createError({ statusCode: 404 })
  const parsed = z.strictObject({ unavailable: z.boolean() }).safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  setTestMapsUnavailable(parsed.data.unavailable)
  return { unavailable: parsed.data.unavailable }
})
