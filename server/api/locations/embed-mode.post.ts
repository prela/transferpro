import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { nodeEnv } from '../../core/index'
import { setTestMapsEmbedOff } from '../../modules/locations'

/**
 * POST /api/locations/embed-mode
 * Test and E2E tell the fake adapter to omit the Embed URL. Any other
 * environment is 404, so this cannot hide a real map.
 */
export default defineEventHandler(async (event) => {
  if (nodeEnv() !== 'test')
    throw createError({ statusCode: 404 })
  const parsed = z.strictObject({ off: z.boolean() }).safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400 })
  setTestMapsEmbedOff(parsed.data.off)
  return { off: parsed.data.off }
})
