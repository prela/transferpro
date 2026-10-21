import { expect, it } from 'vitest'
import { changedWindowFields, coversSpan, freePartnerIds, partnerUnavailable, ridesCoveredBy, unavailableResources } from './unavailability'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
const otherPartnerId = 'a2a2a2a2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'

function at(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 20, hours, minutes))
}

function window(startsAt: Date, endsAt: Date, owner: { driverId?: string, vehicleId?: string, partnerId?: string } = { driverId }) {
  return {
    id: 'd1d1d1d1-1111-4111-8111-111111111111',
    driverId: owner.driverId ?? null,
    vehicleId: owner.vehicleId ?? null,
    partnerId: owner.partnerId ?? null,
    startsAt,
    endsAt,
  }
}

const subject = { driverId, vehicleId, pickupAt: at(10), landingAt: null }

it('covers a span that shares an instant, half-open on both sides', () => {
  const away = { startsAt: at(10), endsAt: at(12) }
  expect(coversSpan(away, at(11), at(13))).toBe(true)
  expect(coversSpan(away, at(9), at(10, 1))).toBe(true)
  // The window ends where the span starts, and starts where the span ends.
  expect(coversSpan(away, at(12), at(13))).toBe(false)
  expect(coversSpan(away, at(9), at(10))).toBe(false)
  // An empty span occupies nothing.
  expect(coversSpan(away, at(11), at(11))).toBe(false)
})

it('names the Driver when a Driver window covers any part of the occupied window', () => {
  // The occupied window is 10:00 to 11:00 with a 60-minute duration.
  expect(unavailableResources(subject, [window(at(10, 59), at(12))], 60)).toEqual(['driver'])
  expect(unavailableResources(subject, [window(at(8), at(10, 1))], 60)).toEqual(['driver'])
})

it('is free at the half-open edges of the occupied window', () => {
  expect(unavailableResources(subject, [window(at(11), at(12))], 60)).toEqual([])
  expect(unavailableResources(subject, [window(at(8), at(10))], 60)).toEqual([])
})

it('names the Vehicle for a Vehicle window, and both once each', () => {
  expect(unavailableResources(subject, [window(at(10), at(11), { vehicleId })], 60)).toEqual(['vehicle'])
  expect(unavailableResources(subject, [
    window(at(10), at(11), { vehicleId }),
    window(at(10), at(11), { driverId }),
    window(at(10, 30), at(11), { driverId }),
  ], 60)).toEqual(['driver', 'vehicle'])
})

it('ignores another Driver or Vehicle', () => {
  expect(unavailableResources(subject, [
    window(at(9), at(12), { driverId: otherDriverId }),
    window(at(9), at(12), { vehicleId: otherVehicleId }),
  ], 60)).toEqual([])
})

it('ends the occupied window from a stored landing', () => {
  const landed = { ...subject, landingAt: at(11) }
  // The landing moves the end to 12:00, so 11:30 is covered.
  expect(unavailableResources(landed, [window(at(11, 30), at(13))], 60)).toEqual(['driver'])
  expect(unavailableResources(subject, [window(at(11, 30), at(13))], 60)).toEqual([])
})

it('lists the occupying Rides of the window\'s Driver or Vehicle that it covers, in the given order', () => {
  const ride = (id: string, pickupAt: Date, owner: { driverId?: string, vehicleId?: string } = {}) => ({
    rideId: id,
    driverId: owner.driverId ?? driverId,
    vehicleId: owner.vehicleId ?? vehicleId,
    partnerId: null,
    pickupAt,
    landingAt: null,
  })
  const early = ride(rideId, at(9))
  const edge = ride('e2e2e2e2-3333-4333-8333-333333333333', at(12))
  const inside = ride('e3e3e3e3-4444-4444-8444-444444444444', at(11))
  const otherDriver = ride('e4e4e4e4-5555-4555-8555-555555555555', at(11), { driverId: otherDriverId })
  const away = window(at(9, 30), at(12))
  expect(ridesCoveredBy(away, [early, edge, inside, otherDriver], 60)).toEqual([early, inside])
  // The same window on the Vehicle reaches every Ride of that Vehicle.
  const vehicleAway = window(at(9, 30), at(12), { vehicleId })
  expect(ridesCoveredBy(vehicleAway, [early, edge, inside, otherDriver], 60)).toEqual([early, inside, otherDriver])
})

it('names the Partner when a Partner window covers any part of the occupied window', () => {
  const handed = { partnerId, pickupAt: at(10), landingAt: null }
  expect(partnerUnavailable(handed, [window(at(10, 59), at(12), { partnerId })], 60)).toEqual(['partner'])
  expect(partnerUnavailable(handed, [window(at(11), at(12), { partnerId })], 60)).toEqual([])
  expect(partnerUnavailable(handed, [window(at(9), at(12), { partnerId: otherPartnerId })], 60)).toEqual([])
})

it('lists a handed-off Ride the Partner window covers, and a Driver window does not', () => {
  const handed = {
    rideId,
    driverId: null,
    vehicleId: null,
    partnerId,
    pickupAt: at(10),
    landingAt: null,
  }
  const other = { ...handed, rideId: 'e2e2e2e2-3333-4333-8333-333333333333', partnerId: otherPartnerId }
  const away = window(at(9, 30), at(12), { partnerId })
  expect(ridesCoveredBy(away, [handed, other], 60)).toEqual([handed])
  expect(ridesCoveredBy(window(at(9, 30), at(12)), [handed], 60)).toEqual([])
})

it('counts a Partner free only when it is active and no window covers the span', () => {
  const covered = window(at(10), at(12), { partnerId })
  const otherAway = window(at(10), at(12), { partnerId: otherPartnerId })
  // A Ride handed to a Partner is not an argument: it does not occupy the Partner.
  expect(freePartnerIds([partnerId, otherPartnerId], [covered], at(11), at(11, 30))).toEqual([otherPartnerId])
  expect(freePartnerIds([partnerId], [otherAway], at(11), at(12))).toEqual([partnerId])
  // Half-open: a window that ends where the span starts leaves the Partner free.
  expect(freePartnerIds([partnerId], [window(at(8), at(10), { partnerId })], at(10), at(11))).toEqual([partnerId])
  expect(freePartnerIds([partnerId], [], at(10), at(10))).toEqual([partnerId])
  expect(freePartnerIds([], [covered], at(10), at(12))).toEqual([])
})

it('names only the instants that changed', () => {
  const before = { startsAt: at(10), endsAt: at(12) }
  expect(changedWindowFields(before, { startsAt: at(10), endsAt: at(12) })).toEqual([])
  expect(changedWindowFields(before, { startsAt: at(9), endsAt: at(12) })).toEqual(['startsAt'])
  expect(changedWindowFields(before, { startsAt: at(10), endsAt: at(13) })).toEqual(['endsAt'])
  expect(changedWindowFields(before, { startsAt: at(9), endsAt: at(13) })).toEqual(['startsAt', 'endsAt'])
})
