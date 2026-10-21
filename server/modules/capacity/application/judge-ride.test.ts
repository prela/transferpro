import { expect, it } from 'vitest'
import { fakeCapacityPorts } from '../testing'
import { judgePartnerCapacity, judgeRideCapacity } from './judge-ride'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

const subject = { rideId, driverId, vehicleId, pickupAt: at(10, 0), landingAt: null }

function other(pickupAt: Date, ids: { driverId?: string, vehicleId?: string } = {}) {
  return {
    rideId: otherId,
    driverId: ids.driverId ?? otherDriverId,
    vehicleId: ids.vehicleId ?? otherVehicleId,
    partnerId: null,
    pickupAt,
    landingAt: null,
  }
}

it('asks the port for this Driver and this Vehicle, leaving out the Ride being judged', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await judgeRideCapacity(ports, subject)
  expect(asked.ridesOf).toEqual([{ rideId, driverId, vehicleId }])
  expect(asked.ridesDuring).toEqual([])
  expect(asked.minutes).toBe(1)
})

it('returns a true overlap in the verdict and leaves the refusal to the caller', async () => {
  const { ports } = fakeCapacityPorts([other(at(10, 30), { driverId })])
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({
    overlaps: [{ resource: 'driver', rideId: otherId }],
    tightGaps: [],
  })
})

it('returns a tight relocation gap and no overlap', async () => {
  const { ports } = fakeCapacityPorts([other(at(11, 10), { vehicleId })])
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({
    overlaps: [],
    tightGaps: [{ resource: 'vehicle', rideId: otherId }],
  })
})

it('judges the window with the Tenant minutes read through tenancy', async () => {
  const { ports } = fakeCapacityPorts([other(at(11, 10), { vehicleId })], { transferDurationMinutes: 90, relocationGapMinutes: 15 })
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({
    overlaps: [{ resource: 'vehicle', rideId: otherId }],
    tightGaps: [],
  })
})

it('returns an empty verdict when nothing else occupies the Driver or the Vehicle', async () => {
  const { ports } = fakeCapacityPorts()
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({ overlaps: [], tightGaps: [] })
})

function away(startsAt: Date, endsAt: Date, owner: { driverId?: string, vehicleId?: string, partnerId?: string }) {
  return {
    id: 'a1a1a1a1-1111-4111-8111-111111111111',
    driverId: owner.driverId ?? null,
    vehicleId: owner.vehicleId ?? null,
    partnerId: owner.partnerId ?? null,
    startsAt,
    endsAt,
  }
}

it('asks for the windows of this Driver and this Vehicle during the occupied window', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await judgeRideCapacity(ports, subject)
  expect(asked.windows).toEqual([{
    driverIds: [driverId],
    vehicleIds: [vehicleId],
    partnerIds: [],
    from: at(10, 0),
    to: at(11, 0),
  }])
})

it('lists the unavailable Driver and Vehicle in the verdict, Driver first', async () => {
  const { ports } = fakeCapacityPorts([], undefined, [
    away(at(10, 59), at(12, 0), { vehicleId }),
    away(at(8, 0), at(10, 1), { driverId }),
  ])
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({
    overlaps: [],
    tightGaps: [],
    unavailable: ['driver', 'vehicle'],
  })
})

it('names nothing unavailable when the window ends where the Ride starts', async () => {
  const { ports } = fakeCapacityPorts([], undefined, [away(at(8, 0), at(10, 0), { driverId })])
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({ overlaps: [], tightGaps: [] })
})

it('lists an unavailable Partner and does not ask who else is taken', async () => {
  const { ports, asked } = fakeCapacityPorts([], undefined, [away(at(10, 0), at(11, 0), { partnerId })])
  await expect(judgePartnerCapacity(ports, { partnerId, pickupAt: at(10, 0), landingAt: null })).resolves.toEqual({
    overlaps: [],
    tightGaps: [],
    unavailable: ['partner'],
  })
  expect(asked.ridesOf).toEqual([])
  expect(asked.ridesDuring).toEqual([])
  expect(asked.windows).toEqual([{
    driverIds: [],
    vehicleIds: [],
    partnerIds: [partnerId],
    from: at(10, 0),
    to: at(11, 0),
  }])
})

it('a handed-off Ride does not make its Partner unavailable', async () => {
  const { ports } = fakeCapacityPorts([{
    rideId: otherId,
    driverId: null,
    vehicleId: null,
    partnerId,
    pickupAt: at(10, 0),
    landingAt: null,
  }])
  await expect(judgePartnerCapacity(ports, { partnerId, pickupAt: at(10, 0), landingAt: null })).resolves.toEqual({
    overlaps: [],
    tightGaps: [],
  })
})

it('ignores a window of another Driver that the port answered with', async () => {
  const { ports } = fakeCapacityPorts([], undefined, [away(at(9, 0), at(12, 0), { driverId: otherDriverId })])
  await expect(judgeRideCapacity(ports, subject)).resolves.toEqual({ overlaps: [], tightGaps: [] })
})
