import { expect, it } from 'vitest'
import { UNCLOSED_MARK_MS, unclosedMarkOn } from './unclosed-mark'

/** The 60 minutes stay fixed. Changing the threshold is a deliberate, reviewed edit. */
it('pins the shared unclosed threshold at 60 minutes', () => {
  expect(UNCLOSED_MARK_MS).toBe(60 * 60_000)
})

const pickupAt = '2026-06-15T08:00:00.000Z'
// 09:00 is pickup plus 60 minutes. The instant is included. One millisecond earlier is not.
const atMark = Date.parse('2026-06-15T09:00:00.000Z')
const beforeMark = Date.parse('2026-06-15T08:59:59.999Z')

it('temporarily is on at pickup plus 60 minutes, including that instant (#476)', () => {
  expect(unclosedMarkOn({
    pickupAt,
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toBe(true)
  expect(unclosedMarkOn({
    pickupAt,
    landingAt: null,
    nowMs: beforeMark,
    transferDurationMinutes: 60,
  })).toBe(false)
})

it('refuses a pickup that is not a time', () => {
  expect(() => unclosedMarkOn({
    pickupAt: 'not-a-time',
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toThrow(new RangeError('Pickup is not a valid time.'))
})

it('temporarily, a stored landing and the transfer duration do not move the mark (#476)', () => {
  const landed = {
    pickupAt,
    landingAt: '2026-06-15T12:00:00.000Z',
    transferDurationMinutes: 90,
  }
  expect(unclosedMarkOn({ ...landed, nowMs: atMark })).toBe(true)
  expect(unclosedMarkOn({ ...landed, nowMs: beforeMark })).toBe(false)
  expect(unclosedMarkOn({
    pickupAt,
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 15,
  })).toBe(true)
})
