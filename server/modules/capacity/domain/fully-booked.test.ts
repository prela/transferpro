import { expect, it } from 'vitest'
import { windowIsFullyBooked } from './fully-booked'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
const otherPartnerId = 'a2a2a2a2-2222-4222-8222-222222222222'
const windowId = 'd1d1d1d1-1111-4111-8111-111111111111'

function at(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

function occupying(ids: { driverId?: string | null, vehicleId?: string | null, rideId?: string } = {}) {
  return {
    rideId: ids.rideId ?? otherId,
    driverId: ids.driverId === undefined ? otherDriverId : ids.driverId,
    vehicleId: ids.vehicleId === undefined ? otherVehicleId : ids.vehicleId,
    partnerId: null,
    pickupAt: at(10, 30),
    landingAt: null,
  }
}

function away(owner: { driverId?: string, vehicleId?: string, partnerId?: string }) {
  return {
    id: windowId,
    driverId: owner.driverId ?? null,
    vehicleId: owner.vehicleId ?? null,
    partnerId: owner.partnerId ?? null,
    startsAt: at(8),
    endsAt: at(12),
  }
}

function judge(overrides: Partial<Parameters<typeof windowIsFullyBooked>[0]> = {}) {
  return windowIsFullyBooked({
    from: at(10),
    to: at(11),
    durationMinutes: 60,
    activeDriverIds: [driverId],
    activeVehicleIds: [vehicleId],
    activePartnerIds: [],
    occupying: [],
    windows: [],
    leaveOutRideId: rideId,
    ...overrides,
  })
}

it('is fully booked when the Tenant has no Partner and no free pair', () => {
  expect(judge({
    activeDriverIds: [],
    activeVehicleIds: [],
    activePartnerIds: [],
  })).toBe(true)
  expect(judge({
    occupying: [occupying({ driverId, vehicleId })],
  })).toBe(true)
})

it('is fully booked when every Partner is unavailable or archived', () => {
  expect(judge({
    activeDriverIds: [],
    activeVehicleIds: [],
    activePartnerIds: [partnerId],
    windows: [away({ partnerId })],
  })).toBe(true)
  // An archived Partner is not in the active list.
  expect(judge({
    activeDriverIds: [],
    activeVehicleIds: [],
    activePartnerIds: [],
  })).toBe(true)
})

it('is not fully booked when a Partner is free', () => {
  expect(judge({
    activeDriverIds: [],
    activeVehicleIds: [],
    activePartnerIds: [partnerId, otherPartnerId],
    windows: [away({ partnerId })],
  })).toBe(false)
})

it('is not fully booked when a Driver and a Vehicle are free, roster or not', () => {
  expect(judge()).toBe(false)
  expect(judge({
    activeDriverIds: [otherDriverId],
    activeVehicleIds: [otherVehicleId],
    occupying: [occupying({ driverId, vehicleId })],
  })).toBe(false)
})

it('leaves out the Ride being changed, so its own pair stays free', () => {
  expect(judge({
    occupying: [occupying({ driverId, vehicleId, rideId })],
  })).toBe(false)
})

it('a chosen pair that is free is never fully booked', () => {
  expect(judge({
    activeDriverIds: [],
    activeVehicleIds: [],
    chosen: { driverId, vehicleId },
  })).toBe(false)
})

it('a tight relocation gap does not take the Driver or the Vehicle', () => {
  expect(judge({
    occupying: [{
      ...occupying({ driverId, vehicleId }),
      pickupAt: at(11, 10),
    }],
  })).toBe(false)
})
