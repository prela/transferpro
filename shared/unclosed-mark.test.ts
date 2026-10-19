import { expect, it } from 'vitest'
import { UNCLOSED_MARK_MS } from './unclosed-mark'

/**
 * The board and the office home both read this value (ADR-0027). It is
 * still under review with the reference operator, so changing it must be a
 * deliberate edit to this pin.
 */
it('pins the shared unclosed threshold at 60 minutes', () => {
  expect(UNCLOSED_MARK_MS).toBe(60 * 60_000)
})
