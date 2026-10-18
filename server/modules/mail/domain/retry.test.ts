import { expect, it } from 'vitest'
import { retryDelayMs } from './retry'

it('spaces the attempts after a failure by 1, 5, and 30 minutes, then stops', () => {
  expect(retryDelayMs(1)).toBe(60_000)
  expect(retryDelayMs(2)).toBe(300_000)
  expect(retryDelayMs(3)).toBe(1_800_000)
  expect(retryDelayMs(4)).toBeNull()
  expect(retryDelayMs(0)).toBeNull()
})
