import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { transferDayFilterCounts } from './ride-attention'
import { sevenDayUnassignedNote, transferDayPartyMatches, transferDaySearchMatches } from './transfer-day-query'

/**
 * Within-day search, Client and Driver narrowing, and the seven-day
 * unassigned note (issue #255). Expected names are the ADR-0038 example
 * ("sutra", "sub"), not a second pass through Intl.
 */

const CLIENT = '00000000-0000-4000-8000-000000000001'
const OTHER_CLIENT = '00000000-0000-4000-8000-000000000002'
const DRIVER = '00000000-0000-4000-8000-000000000010'

function ride(overrides: Partial<Parameters<typeof transferDaySearchMatches>[1]> = {}) {
  return {
    guestName: 'Ana Anić',
    flightNumber: 'OU 384' as string | null,
    clientReference: 'V-19' as string | null,
    tabla: 'GOSPOĐA HORVAT',
    clientId: CLIENT,
    driverId: DRIVER as string | null,
    ...overrides,
  }
}

it('matches a within-day search on the guest, the flight, the Client reference, or the tabla', () => {
  const row = ride()
  expect(transferDaySearchMatches('  ', row)).toBe(true)
  expect(transferDaySearchMatches('anić', row)).toBe(true)
  expect(transferDaySearchMatches('ou 384', row)).toBe(true)
  expect(transferDaySearchMatches('v-19', row)).toBe(true)
  expect(transferDaySearchMatches('gospođa', row)).toBe(true)
  expect(transferDaySearchMatches('hotel', row)).toBe(false)
  expect(transferDaySearchMatches('ou 384', ride({ flightNumber: null, clientReference: null, tabla: '' }))).toBe(false)
})

it('narrows by Client and by Driver, and a Driver filter leaves an unassigned Ride out', () => {
  const row = ride()
  expect(transferDayPartyMatches('', '', row)).toBe(true)
  expect(transferDayPartyMatches(CLIENT, '', row)).toBe(true)
  expect(transferDayPartyMatches(OTHER_CLIENT, '', row)).toBe(false)
  expect(transferDayPartyMatches('', DRIVER, row)).toBe(true)
  expect(transferDayPartyMatches(CLIENT, DRIVER, row)).toBe(true)
  expect(transferDayPartyMatches('', DRIVER, ride({ driverId: null }))).toBe(false)
})

it('counts quick filters on the rows the search and the party filters already kept', () => {
  const kept = ride()
  const dropped = ride({ guestName: 'Ivo', flightNumber: null, clientReference: null, tabla: '', clientId: OTHER_CLIENT })
  const rows = [kept, dropped].filter(row =>
    transferDaySearchMatches('ana', row) && transferDayPartyMatches(CLIENT, '', row),
  )
  const attention = {
    state: 'unassigned' as const,
    pickupAt: '2026-06-16T10:00:00.000Z',
    driverId: null,
    mustAccept: null,
    landingAlarm: false,
    warnings: { expiredDocuments: [], rosterMismatch: false, overlappingRideIds: [] },
  }
  const counts = transferDayFilterCounts(rows.map(row => ({ rideId: row.guestName, ride: attention })), Date.parse('2026-06-15T10:00:00.000Z'))
  expect(counts).toEqual({
    all: 1,
    urgent: 0,
    warnings: 0,
    unassigned: 1,
    waiting: 0,
    inProgress: 0,
    closed: 0,
  })
})

it('names the next seven operational days that have unassigned Rides, in both locales', () => {
  const zone = 'Europe/Zagreb'
  const today = '2026-10-16'
  const at = (day: string, wall: string) => instantFromWallClock(`${day}T${wall}`, zone).toISOString()
  const rides = [
    { pickupAt: at(today, '12:00') },
    { pickupAt: at('2026-10-17', '04:30') },
    { pickupAt: at('2026-10-17', '09:00') },
    { pickupAt: at('2026-10-17', '18:00') },
    { pickupAt: at('2026-10-19', '11:00') },
    { pickupAt: at('2026-10-23', '08:00') },
    { pickupAt: at('2026-10-24', '08:00') },
  ]
  expect(sevenDayUnassignedNote(rides, today, zone, 5, 'hr')).toEqual([
    { date: '2026-10-17', count: 2, name: 'sutra' },
    { date: '2026-10-19', count: 1, name: 'pon' },
    { date: '2026-10-23', count: 1, name: 'pet' },
  ])
  expect(sevenDayUnassignedNote(rides, today, zone, 5, 'en')).toEqual([
    { date: '2026-10-17', count: 2, name: 'tomorrow' },
    { date: '2026-10-19', count: 1, name: 'Mon' },
    { date: '2026-10-23', count: 1, name: 'Fri' },
  ])
  expect(sevenDayUnassignedNote([], today, zone, 5, 'hr')).toEqual([])
  expect(sevenDayUnassignedNote([{ pickupAt: at(today, '12:00') }], today, zone, 5, 'hr')).toEqual([])
})
