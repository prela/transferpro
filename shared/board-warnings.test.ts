import { expect, it } from 'vitest'
import { boardWarningsSchema, deriveBoardWarnings } from './board-warnings'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const laterId = 'e3e3e3e3-4444-4444-8444-444444444444'

const pickupDate = '2026-10-08'
const durationMinutes = 60
const gapMinutes = 15

const validDocuments = {
  drivingLicenceExpiresOn: pickupDate,
  transportLicenceExpiresOn: pickupDate,
  registrationExpiresOn: pickupDate,
  technicalInspectionExpiresOn: pickupDate,
  insuranceExpiresOn: pickupDate,
}

const none = {
  expiredDocuments: [],
  rosterMismatch: false,
  overlappingRideIds: [],
}

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 9, 8, hours, minutes, 0))
}

function occupying(pickupAt: Date, landingAt: Date | null, ids: { rideId?: string, driverId?: string, vehicleId?: string } = {}) {
  return {
    rideId: ids.rideId ?? otherId,
    pickupAt,
    landingAt,
    driverId: ids.driverId ?? driverId,
    vehicleId: ids.vehicleId ?? vehicleId,
  }
}

function derive(overrides: Partial<Parameters<typeof deriveBoardWarnings>[0]> = {}) {
  return deriveBoardWarnings({
    ride: {
      rideId,
      state: 'assigned',
      pickupAt: at(10, 0),
      landingAt: null,
      driverId,
      vehicleId,
    },
    pickupDate,
    documents: validDocuments,
    rosteredDriverId: driverId,
    others: [],
    durationMinutes,
    gapMinutes,
    ...overrides,
  })
}

it('names a driving licence that expired before the pickup day', () => {
  expect(derive({
    documents: { ...validDocuments, drivingLicenceExpiresOn: '2026-10-07' },
  })).toEqual({
    ...none,
    expiredDocuments: ['driving_licence'],
  })
})

it('names a transport licence that expired before the pickup day', () => {
  expect(derive({
    documents: { ...validDocuments, transportLicenceExpiresOn: '2026-10-07' },
  })).toEqual({
    ...none,
    expiredDocuments: ['transport_licence'],
  })
})

it('names a vehicle registration that expired before the pickup day', () => {
  expect(derive({
    documents: { ...validDocuments, registrationExpiresOn: '2026-10-07' },
  })).toEqual({
    ...none,
    expiredDocuments: ['vehicle_registration'],
  })
})

it('names a technical inspection that expired before the pickup day', () => {
  expect(derive({
    documents: { ...validDocuments, technicalInspectionExpiresOn: '2026-10-07' },
  })).toEqual({
    ...none,
    expiredDocuments: ['technical_inspection'],
  })
})

it('names insurance that expired before the pickup day', () => {
  expect(derive({
    documents: { ...validDocuments, insuranceExpiresOn: '2026-10-07' },
  })).toEqual({
    ...none,
    expiredDocuments: ['insurance'],
  })
})

it('does not warn when the expiry day is the pickup day', () => {
  expect(derive()).toEqual(none)
})

it('warns when the expiry day is the day before the pickup', () => {
  expect(derive({
    documents: { ...validDocuments, insuranceExpiresOn: '2026-10-07' },
  }).expiredDocuments).toEqual(['insurance'])
})

it('judges a 02:00 pickup by its calendar date, not the operational day it is listed on', () => {
  // 02:00 on 8 October belongs to the operational day of 7 October.
  // The warning uses the calendar date the caller passes, 8 October.
  expect(derive({
    pickupDate: '2026-10-08',
    documents: { ...validDocuments, drivingLicenceExpiresOn: '2026-10-07' },
  }).expiredDocuments).toEqual(['driving_licence'])
  expect(derive({
    pickupDate: '2026-10-08',
    documents: { ...validDocuments, drivingLicenceExpiresOn: '2026-10-08' },
  }).expiredDocuments).toEqual([])
})

it('names several expired documents in kind order', () => {
  expect(derive({
    documents: {
      drivingLicenceExpiresOn: '2026-10-01',
      transportLicenceExpiresOn: '2026-10-02',
      registrationExpiresOn: '2026-10-03',
      technicalInspectionExpiresOn: '2026-10-04',
      insuranceExpiresOn: '2026-10-05',
    },
  }).expiredDocuments).toEqual([
    'driving_licence',
    'transport_licence',
    'vehicle_registration',
    'technical_inspection',
    'insurance',
  ])
})

it('marks a roster mismatch when the vehicle is rostered to another driver', () => {
  expect(derive({ rosteredDriverId: otherDriverId }).rosterMismatch).toBe(true)
})

it('does not mark a roster mismatch when the vehicle has no roster row', () => {
  expect(derive({ rosteredDriverId: null }).rosterMismatch).toBe(false)
})

it('does not mark a roster mismatch when the roster names this ride\'s driver', () => {
  expect(derive({ rosteredDriverId: driverId }).rosterMismatch).toBe(false)
})

it('names the other ride when the occupied windows share an instant', () => {
  expect(derive({
    others: [occupying(at(10, 30), null)],
  }).overlappingRideIds).toEqual([otherId])
})

it('names the other ride when the gap is shorter than the relocation gap', () => {
  expect(derive({
    others: [occupying(at(11, 10), null, { vehicleId: otherVehicleId })],
  }).overlappingRideIds).toEqual([otherId])
})

it('does not warn when the gap equals the relocation gap', () => {
  expect(derive({
    others: [occupying(at(11, 15), null)],
  }).overlappingRideIds).toEqual([])
})

it('names the other ride when a stored landing stretches the occupied end into it', () => {
  expect(derive({
    ride: {
      rideId,
      state: 'accepted',
      pickupAt: at(10, 0),
      landingAt: at(10, 30),
      driverId,
      vehicleId,
    },
    others: [occupying(at(11, 20), null, { vehicleId: otherVehicleId })],
  }).overlappingRideIds).toEqual([otherId])
})

it('names a vehicle-only clash and a driver-only clash', () => {
  expect(derive({
    others: [occupying(at(10, 30), null, { driverId: otherDriverId })],
  }).overlappingRideIds).toEqual([otherId])
  expect(derive({
    others: [occupying(at(10, 30), null, { vehicleId: otherVehicleId })],
  }).overlappingRideIds).toEqual([otherId])
})

it('names each other ride once, in the order they were given', () => {
  expect(derive({
    others: [
      occupying(at(10, 30), null, { rideId: otherId, vehicleId: otherVehicleId }),
      occupying(at(10, 40), null, { rideId: laterId, driverId: otherDriverId }),
    ],
  }).overlappingRideIds).toEqual([otherId, laterId])
})

it('gives an unassigned or finished ride no warnings', () => {
  const crowded = {
    documents: {
      drivingLicenceExpiresOn: '2020-01-01',
      transportLicenceExpiresOn: '2020-01-01',
      registrationExpiresOn: '2020-01-01',
      technicalInspectionExpiresOn: '2020-01-01',
      insuranceExpiresOn: '2020-01-01',
    },
    rosteredDriverId: otherDriverId,
    others: [occupying(at(10, 30), null)],
  }
  for (const state of ['unassigned', 'done', 'no-show', 'cancelled'] as const) {
    expect(derive({
      ...crowded,
      ride: {
        rideId,
        state,
        pickupAt: at(10, 0),
        landingAt: null,
        driverId: state === 'unassigned' ? null : driverId,
        vehicleId: state === 'unassigned' ? null : vehicleId,
      },
    })).toEqual(none)
  }
})

it('shows the unavailable Driver or Vehicle on an assigned or accepted Ride only', () => {
  expect(derive({ unavailable: ['driver', 'vehicle'] })).toEqual({ ...none, unavailable: ['driver', 'vehicle'] })
  const ride = { rideId, pickupAt: at(10, 0), landingAt: null, driverId, vehicleId }
  expect(derive({ ride: { ...ride, state: 'accepted' }, unavailable: ['vehicle'] })).toEqual({ ...none, unavailable: ['vehicle'] })
  expect(derive({ ride: { ...ride, state: 'done' }, unavailable: ['driver'] })).toEqual(none)
  // No window covers the Ride: the warning is not there at all.
  expect(derive({ unavailable: [] })).toEqual(none)
})

it('accepts the unavailability warning in the day list contract', () => {
  expect(boardWarningsSchema.parse({ ...none, unavailable: ['driver'] })).toEqual({ ...none, unavailable: ['driver'] })
  expect(boardWarningsSchema.safeParse({ ...none, unavailable: ['partner'] }).success).toBe(false)
  expect(boardWarningsSchema.parse(none)).toEqual(none)
})
