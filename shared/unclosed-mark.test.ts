import { expect, it } from 'vitest'
import { UNCLOSED_MARK_MS } from './unclosed-mark'

/** Changing the threshold must be a deliberate, reviewed edit to this pin (ADR-0027). */
it('pins the shared unclosed threshold at 60 minutes', () => {
  expect(UNCLOSED_MARK_MS).toBe(60 * 60_000)
})
