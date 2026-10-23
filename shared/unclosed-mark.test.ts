import { expect, it } from 'vitest'
import { UNCLOSED_MARK_MS, unclosedMarkOn } from './unclosed-mark'

/** The 60 minutes stay fixed. Changing the threshold is a deliberate, reviewed edit. */
it('pins the shared unclosed threshold at 60 minutes', () => {
  expect(UNCLOSED_MARK_MS).toBe(60 * 60_000)
})

// Pickup 10:00 and duration 60 end at 11:00. The mark is 12:00, and that instant is included.
const pickupAt = '2026-06-15T10:00:00.000Z'
const atMark = Date.parse('2026-06-15T12:00:00.000Z')
const beforeMark = Date.parse('2026-06-15T11:59:59.999Z')

it('is on at the occupied end plus 60 minutes, including that instant', () => {
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
  // Pickup plus 60 is 11:00. That is not the mark.
  expect(unclosedMarkOn({
    pickupAt,
    landingAt: null,
    nowMs: Date.parse('2026-06-15T11:00:00.000Z'),
    transferDurationMinutes: 60,
  })).toBe(false)
})

it('a stored landing replaces the pickup, including that landing plus the duration plus 60', () => {
  // Landing 10:00 and duration 60 end at 11:00. The mark is 12:00.
  expect(unclosedMarkOn({
    pickupAt: '2026-06-15T08:00:00.000Z',
    landingAt: '2026-06-15T10:00:00.000Z',
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toBe(true)
  expect(unclosedMarkOn({
    pickupAt: '2026-06-15T08:00:00.000Z',
    landingAt: '2026-06-15T10:00:00.001Z',
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toBe(false)
})

it('a late landing turns a mark off until the new instant', () => {
  const nowMs = atMark
  const open = {
    pickupAt: '2026-06-15T09:00:00.000Z',
    landingAt: null,
    nowMs,
    transferDurationMinutes: 60,
  }
  // No landing: end 10:00, mark 11:00. On at 12:00.
  expect(unclosedMarkOn(open)).toBe(true)
  // Landing 11:30: end 12:30, mark 13:30. Off.
  expect(unclosedMarkOn({
    ...open,
    landingAt: '2026-06-15T11:30:00.000Z',
  })).toBe(false)
})

it('clearing the landing moves the instant back to the pickup plus the duration plus 60', () => {
  const late = {
    pickupAt: '2026-06-15T09:00:00.000Z',
    landingAt: '2026-06-15T11:30:00.000Z' as string | null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  }
  expect(unclosedMarkOn(late)).toBe(false)
  expect(unclosedMarkOn({ ...late, landingAt: null })).toBe(true)
})

it('changing the duration moves the instant', () => {
  const landed = {
    pickupAt: '2026-06-15T08:00:00.000Z',
    landingAt: '2026-06-15T10:00:00.000Z',
    nowMs: atMark,
    transferDurationMinutes: 60,
  }
  // Duration 60 ends at 11:00. The mark is 12:00.
  expect(unclosedMarkOn(landed)).toBe(true)
  // Duration 90 ends at 11:30. The mark is 12:30.
  expect(unclosedMarkOn({ ...landed, transferDurationMinutes: 90 })).toBe(false)
})

it('changing the pickup moves the instant only while no landing is stored', () => {
  expect(unclosedMarkOn({
    pickupAt,
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toBe(true)
  expect(unclosedMarkOn({
    pickupAt: '2026-06-15T10:00:00.001Z',
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toBe(false)
  // Pickup 11:30 with no landing would mark at 13:30. The stored landing keeps 12:00.
  const landed = {
    landingAt: '2026-06-15T10:00:00.000Z',
    nowMs: atMark,
    transferDurationMinutes: 60,
  }
  expect(unclosedMarkOn({ ...landed, pickupAt: '2026-06-15T08:00:00.000Z' })).toBe(true)
  expect(unclosedMarkOn({ ...landed, pickupAt: '2026-06-15T11:30:00.000Z' })).toBe(true)
})

it('refuses a pickup or a landing that is not a time', () => {
  expect(() => unclosedMarkOn({
    pickupAt: 'not-a-time',
    landingAt: null,
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toThrow(new RangeError('Pickup is not a valid time.'))
  expect(() => unclosedMarkOn({
    pickupAt,
    landingAt: 'not-a-time',
    nowMs: atMark,
    transferDurationMinutes: 60,
  })).toThrow(new RangeError('Landing is not a valid time.'))
})
