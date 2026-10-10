import type { OfficeHomeRide } from './office-home'
import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { buildOfficeHome } from './office-home'

/**
 * The office home snapshot. Lists keep every matching Ride. Counts keep
 * only the operational day that contains `now`. Expected guests are
 * literals, not a second copy of the classifier.
 */

const zone = 'Europe/Zagreb'

function ride(overrides: Partial<OfficeHomeRide> & Pick<OfficeHomeRide, 'rideId' | 'pickupAt' | 'state' | 'guestName'>): OfficeHomeRide {
  return {
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    driverId: null,
    driverName: null,
    vehiclePlate: null,
    price: '42.50',
    payment: 'cash',
    flightNumber: null,
    mustAccept: null,
    ...overrides,
  }
}

function guests(rows: { guestName: string }[]): string[] {
  return rows.map(row => row.guestName)
}

it('lists every unfinished unassigned Ride soonest first, and marks only the four hours before pickup', () => {
  const now = new Date('2026-06-15T08:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000003',
      guestName: 'Later',
      pickupAt: '2026-06-15T12:00:00.001Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000002',
      guestName: 'Same late',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000001',
      guestName: 'Same early',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000004',
      guestName: 'Window start',
      pickupAt: '2026-06-15T12:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000005',
      guestName: 'At pickup',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000006',
      guestName: 'Already past',
      pickupAt: '2026-06-15T07:59:59.999Z',
      state: 'unassigned',
    }),
  ], now, zone)

  expect(guests(snapshot.unassigned)).toEqual([
    'Already past',
    'At pickup',
    'Same early',
    'Same late',
    'Window start',
    'Later',
  ])
  const alarm = Object.fromEntries(snapshot.unassigned.map(row => [row.guestName, row.unassignedAlarm]))
  expect(alarm).toEqual({
    'Already past': false,
    'At pickup': false,
    'Same early': true,
    'Same late': true,
    'Window start': true,
    'Later': false,
  })
  expect(snapshot.waitingOnAcceptance).toEqual([])
  expect(snapshot.inProgress).toEqual([])
})

it('keeps waiting on acceptance off the alarm and off the other lists', () => {
  const now = new Date('2026-06-15T08:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000010',
      guestName: 'Waiting past',
      pickupAt: '2026-06-14T08:00:00.000Z',
      state: 'assigned',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000011',
      guestName: 'Waiting soon',
      pickupAt: '2026-06-15T10:00:00.000Z',
      state: 'assigned',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000012',
      guestName: 'Accepted',
      pickupAt: '2026-06-15T07:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000013',
      guestName: 'No acceptance',
      pickupAt: '2026-06-15T07:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      driverId: '00000000-0000-4000-8000-0000000000bb',
      driverName: 'Ana',
      vehiclePlate: 'DU100BB',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000014',
      guestName: 'Declined',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000015',
      guestName: 'Cancelled',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'cancelled',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
  ], now, zone)

  expect(guests(snapshot.waitingOnAcceptance)).toEqual(['Waiting past', 'Waiting soon'])
  expect(snapshot.waitingOnAcceptance.every(row => !('unassignedAlarm' in row))).toBe(true)
  expect(guests(snapshot.unassigned)).toEqual(['Declined'])
  expect(guests(snapshot.inProgress)).toEqual(['Accepted', 'No acceptance'])
  const listed = [
    ...snapshot.unassigned,
    ...snapshot.waitingOnAcceptance,
    ...snapshot.inProgress,
  ].map(row => row.rideId)
  expect(new Set(listed).size).toBe(listed.length)
})

it('derives in progress from a past pickup, including an earlier day, and leaves a future pickup off that list', () => {
  const now = new Date('2026-06-15T10:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000020',
      guestName: 'Yesterday',
      pickupAt: '2026-06-14T08:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000021',
      guestName: 'Still ahead',
      pickupAt: '2026-06-15T15:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000022',
      guestName: 'Unassigned past',
      pickupAt: '2026-06-14T08:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000023',
      guestName: 'Done yesterday',
      pickupAt: '2026-06-14T08:00:00.000Z',
      state: 'done',
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
  ], now, zone)

  expect(guests(snapshot.inProgress)).toEqual(['Yesterday'])
  expect(guests(snapshot.unassigned)).toEqual(['Unassigned past'])
  expect(snapshot.waitingOnAcceptance).toEqual([])
})

it('counts the stored hour, so a 05:30 pickup stays off today when the hour is 06:00 and still appears on the unassigned list', () => {
  const now = instantFromWallClock('2026-01-15T12:00', zone)
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000040',
      guestName: 'Before six',
      pickupAt: instantFromWallClock('2026-01-15T05:30', zone).toISOString(),
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000041',
      guestName: 'At six',
      pickupAt: instantFromWallClock('2026-01-15T06:00', zone).toISOString(),
      state: 'done',
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
  ], now, zone, 6)

  expect(guests(snapshot.unassigned)).toEqual(['Before six'])
  expect(snapshot.counts.unassigned).toBe(0)
  expect(snapshot.counts.rides).toBe(1)
  expect(snapshot.counts.done).toBe(1)
})

it('counts the operational day only, so a list can be larger than its count, and a future assigned Ride is only in the Rides count', () => {
  // 04:30 on 15 January is still the operational day that started at 05:00 on the 14th.
  const now = instantFromWallClock('2026-01-15T04:30', zone)
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000030',
      guestName: 'Late night',
      pickupAt: instantFromWallClock('2026-01-15T00:30', zone).toISOString(),
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000031',
      guestName: 'Next morning',
      pickupAt: instantFromWallClock('2026-01-15T05:00', zone).toISOString(),
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000032',
      guestName: 'Previous cutoff',
      pickupAt: instantFromWallClock('2026-01-14T04:59', zone).toISOString(),
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000033',
      guestName: 'Ahead today',
      pickupAt: instantFromWallClock('2026-01-15T04:45', zone).toISOString(),
      state: 'assigned',
      mustAccept: false,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
      price: '10.00',
      payment: 'card',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000034',
      guestName: 'Done today',
      pickupAt: instantFromWallClock('2026-01-14T12:00', zone).toISOString(),
      state: 'done',
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000035',
      guestName: 'No-show today',
      pickupAt: instantFromWallClock('2026-01-14T18:00', zone).toISOString(),
      state: 'no-show',
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Marko',
      vehiclePlate: 'DU100AA',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000036',
      guestName: 'Cancelled today',
      pickupAt: instantFromWallClock('2026-01-14T20:00', zone).toISOString(),
      state: 'cancelled',
    }),
  ], now, zone)

  expect(guests(snapshot.unassigned)).toEqual(['Previous cutoff', 'Late night', 'Next morning'])
  expect(snapshot.counts).toEqual({
    rides: 5,
    unassigned: 1,
    waitingOnAcceptance: 0,
    inProgress: 0,
    done: 1,
    noShow: 1,
    cancelled: 1,
  })
  expect(snapshot.counts.rides).not.toBe(
    snapshot.counts.unassigned
    + snapshot.counts.waitingOnAcceptance
    + snapshot.counts.inProgress
    + snapshot.counts.done
    + snapshot.counts.noShow
    + snapshot.counts.cancelled,
  )
  expect(Object.keys(snapshot.counts).sort()).toEqual([
    'cancelled',
    'done',
    'inProgress',
    'noShow',
    'rides',
    'unassigned',
    'waitingOnAcceptance',
  ])
  expect(snapshot).not.toHaveProperty('week')
  expect(snapshot).not.toHaveProperty('month')
  expect(snapshot).not.toHaveProperty('total')
})

it('shows price and payment for cash, card, and invoice to agency, and the flight number as text', () => {
  const now = new Date('2026-06-15T08:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000040',
      guestName: 'Cash',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'unassigned',
      price: '42.50',
      payment: 'cash',
      flightNumber: 'OU 384',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000041',
      guestName: 'Card',
      pickupAt: '2026-06-15T10:00:00.000Z',
      state: 'unassigned',
      price: '18.00',
      payment: 'card',
      flightNumber: null,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000042',
      guestName: 'Agency',
      pickupAt: '2026-06-15T11:00:00.000Z',
      state: 'unassigned',
      price: '0.00',
      payment: 'invoice_to_agency',
      flightNumber: 'LH 123',
    }),
  ], now, zone)

  expect(snapshot.unassigned.map(row => ({
    guestName: row.guestName,
    price: row.price,
    payment: row.payment,
    flightNumber: row.flightNumber,
  }))).toEqual([
    { guestName: 'Cash', price: '42.50', payment: 'cash', flightNumber: 'OU 384' },
    { guestName: 'Card', price: '18.00', payment: 'card', flightNumber: null },
    { guestName: 'Agency', price: '0.00', payment: 'invoice_to_agency', flightNumber: 'LH 123' },
  ])
  expect(snapshot.unassigned.every(row => !('flightUrl' in row))).toBe(true)
})

it('returns empty lists and zero counts when nothing matches', () => {
  const snapshot = buildOfficeHome([], new Date('2026-06-15T08:00:00.000Z'), zone)
  expect(snapshot.unassigned).toEqual([])
  expect(snapshot.waitingOnAcceptance).toEqual([])
  expect(snapshot.inProgress).toEqual([])
  expect(snapshot.counts).toEqual({
    rides: 0,
    unassigned: 0,
    waitingOnAcceptance: 0,
    inProgress: 0,
    done: 0,
    noShow: 0,
    cancelled: 0,
  })
})
