import { expect, it } from 'vitest'
import { parseCommandDay } from './command-day'

/**
 * "Idi na dan…" reads a date the office typed. The Transfers URL accepts
 * only YYYY-MM-DD, so the dotted and slashed forms become that.
 */

it('reads an ISO day and the dotted or slashed office forms', () => {
  expect(parseCommandDay('2026-10-20')).toBe('2026-10-20')
  expect(parseCommandDay(' 20.10.2026 ')).toBe('2026-10-20')
  expect(parseCommandDay('6.10.2026')).toBe('2026-10-06')
  expect(parseCommandDay('20/10/2026')).toBe('2026-10-20')
  expect(parseCommandDay('20. 10. 2026.')).toBe('2026-10-20')
})

it('refuses a day that is not a calendar date, a partial date, or other text', () => {
  expect(parseCommandDay('')).toBeNull()
  expect(parseCommandDay('   ')).toBeNull()
  expect(parseCommandDay('2026-02-31')).toBeNull()
  expect(parseCommandDay('31.02.2026')).toBeNull()
  expect(parseCommandDay('32.01.2026')).toBeNull()
  expect(parseCommandDay('20.10')).toBeNull()
  expect(parseCommandDay('20.10.26')).toBeNull()
  expect(parseCommandDay('Ana 20.10.2026')).toBeNull()
  expect(parseCommandDay('OU111')).toBeNull()
  expect(parseCommandDay('V-19')).toBeNull()
})
