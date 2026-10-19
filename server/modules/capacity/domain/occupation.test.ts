import { expect, it } from 'vitest'
import { judgeOccupation } from './occupation'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const minutes = { transferDurationMinutes: 60, relocationGapMinutes: 15 }

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

const subject = { rideId, driverId, vehicleId, pickupAt: at(10, 0), landingAt: null }

function occupying(pickupAt: Date, ids: { driverId?: string, vehicleId?: string, rideId?: string } = {}) {
  return {
    rideId: ids.rideId ?? otherId,
    driverId: ids.driverId ?? otherDriverId,
    vehicleId: ids.vehicleId ?? otherVehicleId,
    partnerId: null,
    pickupAt,
    landingAt: null,
  }
}

it('names a true overlap on the Driver and on the Vehicle the Ride is about to take', () => {
  expect(judgeOccupation(subject, [occupying(at(10, 30), { driverId, vehicleId })], minutes)).toEqual({
    overlaps: [{ resource: 'driver', rideId: otherId }, { resource: 'vehicle', rideId: otherId }],
    tightGaps: [],
  })
})

it('names a tight relocation gap and no overlap', () => {
  expect(judgeOccupation(subject, [occupying(at(11, 10), { vehicleId })], minutes)).toEqual({
    overlaps: [],
    tightGaps: [{ resource: 'vehicle', rideId: otherId }],
  })
})

it('uses the Tenant minutes it is given', () => {
  const longer = { transferDurationMinutes: 120, relocationGapMinutes: 15 }
  expect(judgeOccupation(subject, [occupying(at(11, 10), { driverId })], longer).overlaps).toEqual([
    { resource: 'driver', rideId: otherId },
  ])
})

it('judges nothing for a Ride that shares neither resource, or for the Ride itself', () => {
  expect(judgeOccupation(subject, [occupying(at(10, 0)), occupying(at(10, 0), { rideId, driverId, vehicleId })], minutes)).toEqual({
    overlaps: [],
    tightGaps: [],
  })
})
