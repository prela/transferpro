import type { OfficeHomeRide } from './office-home'
import { expect, it } from 'vitest'
import { instantFromWallClock } from './date'
import { buildOfficeHome, officeHomeBlocks, officeHomeCountPath, officeHomeUrgentKeys, officeHomeUrgentRideCount } from './office-home'

/**
 * The office home snapshot. Lists keep every matching Ride. Counts keep
 * only the operational day that contains `now`. Expected guests are
 * literals, not a second copy of the classifier.
 */

const zone = 'Europe/Zagreb'

function ride(overrides: Partial<OfficeHomeRide> & Pick<OfficeHomeRide, 'rideId' | 'pickupAt' | 'state' | 'guestName'>): OfficeHomeRide {
  return {
    passengerCount: 2,
    clientName: 'Agencija Mora',
    start: 'Zračna luka Dubrovnik',
    end: 'Hotel Excelsior',
    driverId: null,
    driverName: null,
    vehiclePlate: null,
    price: '42.50',
    payment: 'cash',
    flightNumber: null,
    landingAt: null,
    expectedArrival: null,
    tabla: '',
    mustAccept: null,
    ...overrides,
  }
}

function guests(rows: readonly { guestName: string }[]): string[] {
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

it('marks an in-progress Ride once 60 minutes have passed since the scheduled pickup', () => {
  const now = new Date('2026-06-15T10:00:00.000Z')
  const driver = {
    driverId: '00000000-0000-4000-8000-0000000000aa',
    driverName: 'Marko',
    vehiclePlate: 'DU100AA',
  }
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000050',
      guestName: 'Earlier day',
      pickupAt: '2026-06-14T08:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000051',
      guestName: 'Hour',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000052',
      guestName: 'Just under',
      pickupAt: '2026-06-15T09:00:00.001Z',
      state: 'accepted',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000053',
      guestName: 'Waiting past',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'assigned',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000054',
      guestName: 'Unassigned past',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000055',
      guestName: 'Done past',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'done',
      ...driver,
    }),
  ], now, zone)

  expect(guests(snapshot.inProgress)).toEqual(['Earlier day', 'Hour', 'Just under'])
  expect(Object.fromEntries(snapshot.inProgress.map(row => [row.guestName, row.unclosedMark]))).toEqual({
    'Earlier day': true,
    'Hour': true,
    'Just under': false,
  })
  expect(snapshot.inProgress.every(row => !('unassignedAlarm' in row))).toBe(true)
  expect(snapshot.waitingOnAcceptance.every(row => !('unclosedMark' in row))).toBe(true)
  expect(snapshot.unassigned.every(row => !('unclosedMark' in row))).toBe(true)
  expect(snapshot.counts.inProgress).toBe(2)
})

it('shows a landing alarm 60 minutes after the landing plus the transfer duration, and leaves a Ride with no landing on the unclosed mark', () => {
  const now = new Date('2026-06-15T10:00:00.000Z')
  const driver = {
    driverId: '00000000-0000-4000-8000-0000000000aa',
    driverName: 'Marko',
    vehiclePlate: 'DU100AA',
  }
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000060',
      guestName: 'Landed',
      pickupAt: '2026-06-15T08:00:00.000Z',
      landingAt: '2026-06-15T08:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000061',
      guestName: 'Just short',
      pickupAt: '2026-06-15T08:00:00.000Z',
      landingAt: '2026-06-15T08:00:00.001Z',
      state: 'accepted',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000062',
      guestName: 'No landing',
      pickupAt: '2026-06-15T08:00:00.000Z',
      landingAt: null,
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000063',
      guestName: 'Fresh pickup',
      pickupAt: '2026-06-15T09:30:00.000Z',
      landingAt: '2026-06-15T07:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000064',
      guestName: 'Waiting landed',
      pickupAt: '2026-06-15T08:00:00.000Z',
      landingAt: '2026-06-15T07:00:00.000Z',
      state: 'assigned',
      mustAccept: true,
      ...driver,
    }),
  ], now, zone)

  expect(Object.fromEntries(snapshot.inProgress.map(row => [row.guestName, row.landingAlarm]))).toEqual({
    'Landed': true,
    'Just short': false,
    'No landing': false,
    'Fresh pickup': true,
  })
  expect(Object.fromEntries(snapshot.inProgress.map(row => [row.guestName, row.unclosedMark]))).toEqual({
    'Landed': true,
    'Just short': true,
    'No landing': true,
    'Fresh pickup': false,
  })
  expect(snapshot.waitingOnAcceptance.every(row => !('landingAlarm' in row))).toBe(true)
  expect(guests(snapshot.waitingOnAcceptance)).toEqual(['Waiting landed'])

  const longer = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000060',
      guestName: 'Landed',
      pickupAt: '2026-06-15T08:00:00.000Z',
      landingAt: '2026-06-15T08:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
  ], now, zone, 5, 90)
  expect(longer.inProgress[0]?.landingAlarm).toBe(false)
  expect(longer.inProgress[0]?.unclosedMark).toBe(true)
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

it('counts the operational day only, so a list can be larger than its count, and the seven parts add up to the total', () => {
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
    assignedNotStarted: 1,
    inProgress: 0,
    done: 1,
    noShow: 1,
    cancelled: 1,
  })
  expect(snapshot.operationalDate).toBe('2026-01-14')
  expect(snapshot.operationalDayStartHour).toBe(5)
  expect(
    snapshot.counts.unassigned
    + snapshot.counts.waitingOnAcceptance
    + snapshot.counts.assignedNotStarted
    + snapshot.counts.inProgress
    + snapshot.counts.done
    + snapshot.counts.noShow
    + snapshot.counts.cancelled,
  ).toBe(snapshot.counts.rides)
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
      tabla: 'GOSPOĐA HORVAT',
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
    tabla: row.tabla,
  }))).toEqual([
    { guestName: 'Cash', price: '42.50', payment: 'cash', flightNumber: 'OU 384', tabla: 'GOSPOĐA HORVAT' },
    { guestName: 'Card', price: '18.00', payment: 'card', flightNumber: null, tabla: '' },
    { guestName: 'Agency', price: '0.00', payment: 'invoice_to_agency', flightNumber: 'LH 123', tabla: '' },
  ])
  expect(snapshot.unassigned.every(row => !('flightUrl' in row))).toBe(true)
})

it('names the urgent marks already on the office home read', () => {
  const now = new Date('2026-06-15T08:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000051',
      guestName: 'Soon',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000052',
      guestName: 'Far',
      pickupAt: '2026-06-15T13:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000053',
      guestName: 'Forgotten',
      pickupAt: '2026-06-15T06:00:00.000Z',
      state: 'accepted',
      driverId: 'driver-1',
      driverName: 'Ana',
      vehiclePlate: 'DU1',
      landingAt: '2026-06-15T05:00:00.000Z',
    }),
  ], now, zone)

  expect(officeHomeUrgentKeys(snapshot)).toEqual([
    'unassigned-alarm:00000000-0000-4000-8000-000000000051',
    'landing-alarm:00000000-0000-4000-8000-000000000053',
    'unclosed-mark:00000000-0000-4000-8000-000000000053',
  ])
})

it('carries a decline alert and the Driver name on an unassigned Ride of any day, and drops both once the Ride is assigned', () => {
  // Noon in Zagreb. Today, tomorrow, and a later day are three operational days.
  const now = new Date('2026-06-15T10:00:00.000Z')
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000061',
      guestName: 'Today',
      pickupAt: '2026-06-15T12:00:00.000Z',
      state: 'unassigned',
      declineAlerts: [
        { driverName: 'Marko Vozač' },
        { driverName: 'Ana Vozač' },
      ],
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000062',
      guestName: 'Tomorrow',
      pickupAt: '2026-06-16T08:00:00.000Z',
      state: 'unassigned',
      declineAlerts: [{ driverName: 'Ivo Vozač' }],
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000063',
      guestName: 'Later',
      pickupAt: '2026-06-20T08:00:00.000Z',
      state: 'unassigned',
      declineAlerts: [{ driverName: 'Petra Vozač' }],
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000064',
      guestName: 'No decline',
      pickupAt: '2026-06-15T11:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000065',
      guestName: 'Assigned again',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      driverId: '00000000-0000-4000-8000-0000000000aa',
      driverName: 'Nika',
      vehiclePlate: 'DU100AA',
      declineAlerts: [{ driverName: 'Stari Vozač' }],
    }),
  ], now, zone)

  expect(snapshot.unassigned.map(row => ({
    guestName: row.guestName,
    declineAlerts: row.declineAlerts,
  }))).toEqual([
    { guestName: 'No decline', declineAlerts: [] },
    {
      guestName: 'Today',
      declineAlerts: [{ driverName: 'Marko Vozač' }, { driverName: 'Ana Vozač' }],
    },
    { guestName: 'Tomorrow', declineAlerts: [{ driverName: 'Ivo Vozač' }] },
    { guestName: 'Later', declineAlerts: [{ driverName: 'Petra Vozač' }] },
  ])
  expect(snapshot.inProgress.map(row => row.guestName)).toEqual(['Assigned again'])
  expect(snapshot.inProgress.every(row => !('declineAlerts' in row))).toBe(true)
  expect(snapshot.waitingOnAcceptance.every(row => !('declineAlerts' in row))).toBe(true)
  expect(JSON.stringify(snapshot)).not.toContain('Stari Vozač')
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
    assignedNotStarted: 0,
    inProgress: 0,
    done: 0,
    noShow: 0,
    cancelled: 0,
  })
  expect(snapshot.operationalDate).toBe('2026-06-15')
  expect(snapshot.operationalDayStartHour).toBe(5)
})

it('puts each listed Ride in one Home block, and past pickup and a decline in Pozornost', () => {
  const now = new Date('2026-06-15T10:00:00.000Z')
  const driver = {
    driverId: '00000000-0000-4000-8000-0000000000aa',
    driverName: 'Marko',
    vehiclePlate: 'DU100AA',
  }
  const snapshot = buildOfficeHome([
    ride({
      rideId: '00000000-0000-4000-8000-000000000071',
      guestName: 'Past',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'unassigned',
      declineAlerts: [{ driverName: 'Ivo Vozač' }],
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000072',
      guestName: 'Soon',
      pickupAt: '2026-06-15T12:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000073',
      guestName: 'Declined',
      pickupAt: '2026-06-15T18:00:00.000Z',
      state: 'unassigned',
      declineAlerts: [{ driverName: 'Ana Vozač' }],
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000074',
      guestName: 'Plain',
      pickupAt: '2026-06-15T20:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000075',
      guestName: 'Tomorrow',
      pickupAt: '2026-06-16T08:00:00.000Z',
      state: 'unassigned',
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000076',
      guestName: 'Waiting',
      pickupAt: '2026-06-15T13:00:00.000Z',
      state: 'assigned',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000077',
      guestName: 'Landed',
      pickupAt: '2026-06-15T08:00:00.000Z',
      state: 'accepted',
      mustAccept: true,
      landingAt: '2026-06-15T07:00:00.000Z',
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000078',
      guestName: 'Fresh',
      pickupAt: '2026-06-15T09:40:00.000Z',
      state: 'accepted',
      mustAccept: true,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-000000000079',
      guestName: 'Ahead',
      pickupAt: '2026-06-15T15:00:00.000Z',
      state: 'assigned',
      mustAccept: false,
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-00000000007a',
      guestName: 'Done',
      pickupAt: '2026-06-15T09:00:00.000Z',
      state: 'done',
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-00000000007b',
      guestName: 'Missed',
      pickupAt: '2026-06-15T09:10:00.000Z',
      state: 'no-show',
      ...driver,
    }),
    ride({
      rideId: '00000000-0000-4000-8000-00000000007c',
      guestName: 'Called off',
      pickupAt: '2026-06-15T09:20:00.000Z',
      state: 'cancelled',
    }),
  ], now, zone, 5, 90)

  expect(snapshot.counts).toEqual({
    rides: 11,
    unassigned: 4,
    waitingOnAcceptance: 1,
    assignedNotStarted: 1,
    inProgress: 2,
    done: 1,
    noShow: 1,
    cancelled: 1,
  })
  expect(
    snapshot.counts.unassigned
    + snapshot.counts.waitingOnAcceptance
    + snapshot.counts.assignedNotStarted
    + snapshot.counts.inProgress
    + snapshot.counts.done
    + snapshot.counts.noShow
    + snapshot.counts.cancelled,
  ).toBe(11)

  const blocks = officeHomeBlocks(snapshot)
  expect(blocks.attention.map(group => [group.kind, group.rides.map(row => row.guestName)])).toEqual([
    ['unassigned-past-pickup', ['Past']],
    ['unassigned-alarm', ['Soon']],
    ['decline-alert', ['Declined']],
    ['landing-alarm', ['Landed']],
  ])
  expect(blocks.attention[0]?.rides[0]?.marks).toEqual([
    { kind: 'unassigned-past-pickup' },
    { kind: 'decline-alert', driverName: 'Ivo Vozač' },
  ])
  expect(blocks.attention[3]?.rides[0]?.marks.map(mark => mark.kind)).toEqual(['landing-alarm', 'unclosed-mark'])
  expect(guests(blocks.unassigned)).toEqual(['Plain', 'Tomorrow'])
  expect(guests(blocks.waitingOnAcceptance)).toEqual(['Waiting'])
  expect(guests(blocks.inProgress)).toEqual(['Fresh'])
  expect(officeHomeUrgentRideCount(snapshot)).toBe(4)

  const placed = [
    ...blocks.attention.flatMap(group => group.rides),
    ...blocks.unassigned,
    ...blocks.waitingOnAcceptance,
    ...blocks.inProgress,
  ].map(row => row.rideId)
  const listed = [
    ...snapshot.unassigned,
    ...snapshot.waitingOnAcceptance,
    ...snapshot.inProgress,
  ].map(row => row.rideId)
  expect(placed.sort()).toEqual(listed.sort())
  expect(new Set(placed).size).toBe(placed.length)
  expect(officeHomeCountPath(snapshot.operationalDate, 'rides')).toBe('/transfers?day=2026-06-15')
  expect(officeHomeCountPath(snapshot.operationalDate, 'assignedNotStarted')).toBe('/transfers?day=2026-06-15&filter=assignedNotStarted')
  expect(officeHomeCountPath(snapshot.operationalDate, 'done')).toBe('/transfers?day=2026-06-15&filter=done')
})
