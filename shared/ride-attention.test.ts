import { expect, it } from 'vitest'
import { calendarDateInTimeZone } from './date'
import {
  classifyRideAttention,
  homeRowNamesTheDate,
  parseTransferDayFilter,
  pickupNeedsCalendarDate,
  rideAttentionTier,
  rideStateMark,
  transferDayFilterCounts,
  transferDayFilterMatches,
} from './ride-attention'
import { UNCLOSED_MARK_MS } from './unclosed-mark'

/**
 * Urgent and warning kinds for one Ride (ADR-0039). Expected kinds are
 * literals from the record, not a second copy of the classifier.
 */

const NOW = Date.parse('2026-06-15T10:00:00.000Z')
const HOUR = 60 * 60 * 1000

function source(overrides: Partial<Parameters<typeof classifyRideAttention>[0]> = {}) {
  return {
    state: 'unassigned' as const,
    pickupAt: new Date(NOW + 5 * HOUR).toISOString(),
    driverId: null,
    mustAccept: null,
    landingAlarm: false,
    warnings: {
      expiredDocuments: [],
      rosterMismatch: false,
      overlappingRideIds: [],
    },
    ...overrides,
  }
}

it('marks an unassigned Ride whose pickup has passed, and not the four-hour alarm', () => {
  const items = classifyRideAttention(
    source({ pickupAt: new Date(NOW - 60_000).toISOString() }),
    [],
    NOW,
  )
  expect(items).toEqual([
    { tier: 'urgent', kind: 'unassigned-past-pickup' },
  ])
})

it('marks an unassigned Ride inside the four hours before pickup, including the four-hour instant', () => {
  expect(classifyRideAttention(source({ pickupAt: new Date(NOW + 4 * HOUR).toISOString() }), [], NOW)).toEqual([
    { tier: 'urgent', kind: 'unassigned-alarm' },
  ])
  expect(classifyRideAttention(source({ pickupAt: new Date(NOW + 4 * HOUR + 1).toISOString() }), [], NOW)).toEqual([])
  expect(classifyRideAttention(source({ pickupAt: new Date(NOW).toISOString() }), [], NOW)).toEqual([])
})

it('names each decline and keeps a past pickup beside it', () => {
  const items = classifyRideAttention(
    source({ pickupAt: new Date(NOW - 60_000).toISOString() }),
    [{ driverName: 'Ana Vozač' }, { driverName: 'Marko Vozač' }],
    NOW,
  )
  expect(items).toEqual([
    { tier: 'urgent', kind: 'unassigned-past-pickup' },
    { tier: 'urgent', kind: 'decline-alert', driverName: 'Ana Vozač' },
    { tier: 'urgent', kind: 'decline-alert', driverName: 'Marko Vozač' },
  ])
})

it('marks a landing alarm and an unclosed Ride from the pickup, and a landing does not clear the mark', () => {
  const open = source({
    state: 'accepted',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: false,
    pickupAt: new Date(NOW - HOUR).toISOString(),
    landingAlarm: true,
  })
  expect(classifyRideAttention(open, [], NOW)).toEqual([
    { tier: 'urgent', kind: 'landing-alarm' },
    { tier: 'urgent', kind: 'unclosed-mark' },
  ])
  const fresh = source({
    state: 'accepted',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: false,
    pickupAt: new Date(NOW - HOUR + 1).toISOString(),
    landingAlarm: false,
  })
  expect(classifyRideAttention(fresh, [], NOW)).toEqual([])
})

it('treats overlap, a short gap, a roster mismatch, and an expired document as warnings', () => {
  const items = classifyRideAttention(source({
    state: 'assigned',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: false,
    warnings: {
      expiredDocuments: ['insurance'],
      rosterMismatch: true,
      overlappingRideIds: ['00000000-0000-4000-8000-000000000099'],
    },
  }), [], NOW)
  expect(items).toEqual([
    { tier: 'warning', kind: 'overlap' },
    { tier: 'warning', kind: 'roster-mismatch' },
    { tier: 'warning', kind: 'expired-document' },
  ])
})

it('counts quick filters from the same classification', () => {
  const past = source({ pickupAt: new Date(NOW - 60_000).toISOString() })
  const waiting = source({
    state: 'assigned',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: true,
    pickupAt: new Date(NOW + 2 * HOUR).toISOString(),
  })
  const closed = source({ state: 'cancelled' })
  const rides = [
    { rideId: 'a', ride: past },
    { rideId: 'b', ride: waiting },
    { rideId: 'c', ride: closed },
  ]
  expect(transferDayFilterCounts(rides, NOW)).toEqual({
    all: 3,
    urgent: 1,
    warnings: 0,
    unassigned: 1,
    waiting: 1,
    inProgress: 0,
    closed: 1,
  })
  expect(transferDayFilterMatches('urgent', past, [], NOW)).toBe(true)
  expect(transferDayFilterMatches('closed', closed, [], NOW)).toBe(true)
  expect(transferDayFilterMatches('waiting', waiting, [], NOW)).toBe(true)
  expect(parseTransferDayFilter('urgent')).toBe('urgent')
  expect(parseTransferDayFilter('nope')).toBe('all')
})

it('opens the Home balance parts that are not toolbar chips', () => {
  const ahead = source({
    state: 'accepted',
    mustAccept: true,
    driverId: '00000000-0000-4000-8000-000000000010',
    pickupAt: new Date(NOW + HOUR).toISOString(),
  })
  const done = source({
    state: 'done',
    driverId: '00000000-0000-4000-8000-000000000010',
  })
  expect(parseTransferDayFilter('assignedNotStarted')).toBe('assignedNotStarted')
  expect(parseTransferDayFilter('done')).toBe('done')
  expect(transferDayFilterMatches('assignedNotStarted', ahead, [], NOW)).toBe(true)
  expect(transferDayFilterMatches('assignedNotStarted', source(), [], NOW)).toBe(false)
  expect(transferDayFilterMatches('done', done, [], NOW)).toBe(true)
  expect(transferDayFilterMatches('noShow', source({ state: 'no-show' }), [], NOW)).toBe(true)
  expect(transferDayFilterMatches('cancelled', source({ state: 'cancelled' }), [], NOW)).toBe(true)
  expect(transferDayFilterMatches('closed', done, [], NOW)).toBe(true)
  expect(parseTransferDayFilter('handedOff')).toBe('handedOff')
  expect(transferDayFilterMatches('handedOff', source({ state: 'handed_off' }), [], NOW)).toBe(true)
  expect(transferDayFilterMatches('unassigned', source({ state: 'handed_off' }), [], NOW)).toBe(false)
  expect(transferDayFilterMatches('inProgress', source({ state: 'handed_off' }), [], NOW)).toBe(false)
})

it('marks a handed-off Ride at the shared unclosed threshold, and not as unassigned or in progress', () => {
  const at = source({
    state: 'handed_off',
    pickupAt: new Date(NOW - UNCLOSED_MARK_MS).toISOString(),
  })
  expect(classifyRideAttention(at, [], NOW)).toEqual([
    { tier: 'urgent', kind: 'unclosed-mark' },
  ])
  expect(rideStateMark(at, NOW).key).toBe('handedOff')
  const before = source({
    state: 'handed_off',
    pickupAt: new Date(NOW - UNCLOSED_MARK_MS + 1).toISOString(),
  })
  expect(classifyRideAttention(before, [], NOW)).toEqual([])
  const recent = source({
    state: 'handed_off',
    pickupAt: new Date(NOW - 60_000).toISOString(),
  })
  expect(classifyRideAttention(recent, [], NOW)).toEqual([])
})

it('shows the calendar date when the pickup falls on the next calendar day', () => {
  const zone = 'Europe/Zagreb'
  const pickupAt = '2026-06-15T23:30:00.000Z'
  const day = '2026-06-15'
  expect(calendarDateInTimeZone(zone, new Date(pickupAt))).toBe('2026-06-16')
  expect(pickupNeedsCalendarDate(pickupAt, day, zone)).toBe(true)
  expect(pickupNeedsCalendarDate('2026-06-15T10:00:00.000Z', day, zone)).toBe(false)
})

it('names the date on Home when the pickup is another operational day', () => {
  const zone = 'Europe/Zagreb'
  const startHour = 4
  // 02:30 in Zagreb on 16 June is still the operational day of 15 June.
  const beforeStart = '2026-06-16T00:30:00.000Z'
  expect(homeRowNamesTheDate(beforeStart, '2026-06-16', zone, startHour)).toBe(true)
  expect(homeRowNamesTheDate(beforeStart, '2026-06-15', zone, startHour)).toBe(true)
  expect(homeRowNamesTheDate('2026-06-15T10:00:00.000Z', '2026-06-15', zone, startHour)).toBe(false)
})

it('paints a Ride state as icon-ready text: waiting outlined, in progress, finished muted', () => {
  expect(rideStateMark(source(), NOW)).toEqual({ key: 'unassigned', color: 'warning', variant: 'outline', muted: false })
  expect(rideStateMark(source({
    state: 'assigned',
    mustAccept: true,
    driverId: '00000000-0000-4000-8000-000000000010',
  }), NOW)).toEqual({ key: 'waiting', color: 'warning', variant: 'outline', muted: false })
  expect(rideStateMark(source({
    state: 'accepted',
    mustAccept: false,
    driverId: '00000000-0000-4000-8000-000000000010',
    pickupAt: new Date(NOW - 60_000).toISOString(),
  }), NOW)).toEqual({ key: 'inProgress', color: 'info', variant: 'subtle', muted: false })
  expect(rideStateMark(source({ state: 'cancelled' }), NOW)).toEqual({
    key: 'cancelled',
    color: 'neutral',
    variant: 'subtle',
    muted: true,
  })
})

it('shows Popunjeno as a warning on an unfinished unassigned Ride, and not on an assigned one', () => {
  const booked = classifyRideAttention(source({
    warnings: {
      expiredDocuments: [],
      rosterMismatch: false,
      overlappingRideIds: [],
      fullyBooked: true,
    },
  }), [], NOW)
  expect(booked).toEqual([
    { tier: 'warning', kind: 'fully-booked' },
  ])
  expect(rideAttentionTier('fully-booked')).toBe('warning')
  expect(transferDayFilterMatches('warnings', source({
    warnings: {
      expiredDocuments: [],
      rosterMismatch: false,
      overlappingRideIds: [],
      fullyBooked: true,
    },
  }), [], NOW)).toBe(true)
  const assigned = classifyRideAttention(source({
    state: 'assigned',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: false,
    warnings: {
      expiredDocuments: [],
      rosterMismatch: false,
      overlappingRideIds: [],
      fullyBooked: true,
    },
  }), [], NOW)
  expect(assigned).toEqual([])
})

it('puts the unavailability warning in the Warning tier, after an overlap and before a roster mismatch', () => {
  const items = classifyRideAttention(source({
    state: 'accepted',
    driverId: '00000000-0000-4000-8000-000000000010',
    mustAccept: true,
    warnings: {
      expiredDocuments: [],
      rosterMismatch: true,
      overlappingRideIds: ['00000000-0000-4000-8000-000000000099'],
      unavailable: ['vehicle'],
    },
  }), [], NOW)
  expect(items).toEqual([
    { tier: 'warning', kind: 'overlap' },
    { tier: 'warning', kind: 'unavailable' },
    { tier: 'warning', kind: 'roster-mismatch' },
  ])
  expect(rideAttentionTier('unavailable')).toBe('warning')
})
