import { expect, it } from 'vitest'
import { fakeCapacityPorts } from './fake-ports'
import { judgeRideCapacity } from './judge-ride'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'

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
