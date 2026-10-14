import { expect, it } from 'vitest'
import { guardReadiness, NotReadyError } from './readiness'

/**
 * Readiness seam: the probe is the database and the runtime-role check.
 * The HTTP route only reports what this function decides.
 */
it('stays ready when the probe accepts the connections', async () => {
  await expect(guardReadiness(async () => {})).resolves.toBeUndefined()
})

it('answers 503 without the probe error when the database is unusable', async () => {
  const error = await guardReadiness(async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:1 password=secret')
  }).catch(caught => caught)

  expect(error).toBeInstanceOf(NotReadyError)
  expect(error).toMatchObject({ statusCode: 503, message: 'Not ready' })
  expect(String(error)).not.toContain('secret')
  expect(String(error)).not.toContain('ECONNREFUSED')
})
