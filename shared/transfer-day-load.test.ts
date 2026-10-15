import { expect, it } from 'vitest'
import { claimDayLoad, claimFullLoad } from './transfer-day-load'

/**
 * The day read and the first full read share one counter. An unreadable
 * day must not retire the full read that is already in flight (issue #252).
 */

it('does not advance the request counter when the day cannot be read', () => {
  const full = claimFullLoad(0)
  const day = claimDayLoad(full.counter, 'not-a-date')
  expect(day).toBeNull()
  expect(full.counter).toBe(1)
})

it('gives the day read a newer ticket than the full read when the date is real', () => {
  const full = claimFullLoad(4)
  const day = claimDayLoad(full.counter, '2026-06-15')
  expect(day).toEqual({ counter: 6, ticket: 6 })
  expect(full.ticket).toBe(5)
})
