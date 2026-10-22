import type { ActiveFleet } from './ports'
import { expect, it } from 'vitest'
import { fakeCapacityPorts } from '../testing'
import { readBoardFullyBooked } from './fully-booked'
import { judgePartnerCapacity, judgeRideCapacity } from './judge-ride'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const partnerId = 'a1a1a1a1-1111-4111-8111-111111111111'
const otherPartnerId = 'a2a2a2a2-2222-4222-8222-222222222222'

function at(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

const subject = { rideId, driverId, vehicleId, pickupAt: at(10), landingAt: null }

function fleet(ids: { driverIds?: readonly string[], vehicleIds?: readonly string[], partnerIds?: readonly string[] } = {}): ActiveFleet & { calls: number } {
  const recorded = { calls: 0 }
  const read = async (values: readonly string[] | undefined) => {
    recorded.calls += 1
    return values ?? []
  }
  return {
    get calls() {
      return recorded.calls
    },
    driverIds: () => read(ids.driverIds),
    vehicleIds: () => read(ids.vehicleIds),
    partnerIds: () => read(ids.partnerIds),
  }
}

it('a free chosen pair is not fully booked and the fleet is not read', async () => {
  const { ports, asked } = fakeCapacityPorts()
  const active = fleet({ driverIds: [], vehicleIds: [], partnerIds: [] })
  await expect(judgeRideCapacity(ports, subject, active)).resolves.toMatchObject({ fullyBooked: false })
  expect(active.calls).toBe(0)
  expect(asked.ridesDuring).toEqual([])
})

it('is fully booked when the chosen pair is taken and nothing else is free', async () => {
  const { ports, asked } = fakeCapacityPorts([{
    rideId: otherId,
    driverId,
    vehicleId,
    partnerId: null,
    pickupAt: at(10, 30),
    landingAt: null,
  }])
  const active = fleet({ driverIds: [driverId], vehicleIds: [vehicleId] })
  await expect(judgeRideCapacity(ports, subject, active)).resolves.toMatchObject({
    overlaps: [{ resource: 'driver', rideId: otherId }, { resource: 'vehicle', rideId: otherId }],
    fullyBooked: true,
  })
  expect(asked.ridesDuring).toEqual([{
    of: 'tenant',
    from: at(9),
    to: at(11),
    leaveOut: rideId,
  }])
})

it('a free Partner keeps the window open', async () => {
  const { ports } = fakeCapacityPorts([{
    rideId: otherId,
    driverId,
    vehicleId,
    partnerId: null,
    pickupAt: at(10, 30),
    landingAt: null,
  }])
  await expect(judgeRideCapacity(ports, subject, fleet({
    driverIds: [driverId],
    vehicleIds: [vehicleId],
    partnerIds: [partnerId],
  }))).resolves.toMatchObject({ fullyBooked: false })
})

it('a free Driver and a free Vehicle keep the window open, roster or not', async () => {
  const { ports } = fakeCapacityPorts([{
    rideId: otherId,
    driverId,
    vehicleId,
    partnerId: null,
    pickupAt: at(10, 30),
    landingAt: null,
  }])
  await expect(judgeRideCapacity(ports, subject, fleet({
    driverIds: [driverId, otherDriverId],
    vehicleIds: [vehicleId, otherVehicleId],
  }))).resolves.toMatchObject({ fullyBooked: false })
})

it('an unavailable Partner is fully booked only when nothing else is free', async () => {
  const window = {
    id: 'd1d1d1d1-1111-4111-8111-111111111111',
    driverId: null,
    vehicleId: null,
    partnerId,
    startsAt: at(8),
    endsAt: at(12),
  }
  const taken = fakeCapacityPorts([], undefined, [window])
  await expect(judgePartnerCapacity(taken.ports, { rideId, partnerId, pickupAt: at(10), landingAt: null }, fleet({
    partnerIds: [partnerId],
  }))).resolves.toMatchObject({ unavailable: ['partner'], fullyBooked: true })

  const open = fakeCapacityPorts([], undefined, [window])
  await expect(judgePartnerCapacity(open.ports, { rideId, partnerId, pickupAt: at(10), landingAt: null }, fleet({
    partnerIds: [partnerId, otherPartnerId],
  }))).resolves.toMatchObject({ unavailable: ['partner'], fullyBooked: false })
})

it('names an unassigned Ride on the board when nothing is free, and drops it when a pair or a Partner is', async () => {
  const ride = { rideId, pickupAt: at(10), landingAt: null }
  const none = fakeCapacityPorts()
  await expect(readBoardFullyBooked(none.ports, fleet(), 'dispatcher', {
    rides: [ride],
    durationMinutes: 60,
  })).resolves.toEqual(new Set([rideId]))

  const pair = fakeCapacityPorts()
  await expect(readBoardFullyBooked(pair.ports, fleet({
    driverIds: [driverId],
    vehicleIds: [vehicleId],
  }), 'admin', {
    rides: [ride],
    durationMinutes: 60,
  })).resolves.toEqual(new Set())

  const partner = fakeCapacityPorts()
  await expect(readBoardFullyBooked(partner.ports, fleet({ partnerIds: [partnerId] }), 'dispatcher', {
    rides: [ride],
    durationMinutes: 60,
  })).resolves.toEqual(new Set())
})

it('reads the fleet, the occupation, and the windows once across the board', async () => {
  const laterId = 'e3e3e3e3-4444-4444-8444-444444444444'
  const { ports, asked } = fakeCapacityPorts()
  const active = fleet({
    driverIds: [driverId],
    vehicleIds: [vehicleId],
    partnerIds: [partnerId],
  })
  await readBoardFullyBooked(ports, active, 'dispatcher', {
    rides: [
      { rideId: laterId, pickupAt: at(14), landingAt: null },
      { rideId, pickupAt: at(10), landingAt: null },
    ],
    durationMinutes: 60,
  })
  expect(active.calls).toBe(3)
  expect(asked.ridesDuring).toEqual([{
    of: 'tenant',
    from: at(9),
    to: at(15),
  }])
  expect(asked.windows).toEqual([{
    driverIds: [driverId],
    vehicleIds: [vehicleId],
    partnerIds: [partnerId],
    from: at(10),
    to: at(15),
  }])
})

it('does not read occupation when no pair is possible', async () => {
  const window = {
    id: 'd1d1d1d1-1111-4111-8111-111111111111',
    driverId: null,
    vehicleId: null,
    partnerId,
    startsAt: at(8),
    endsAt: at(12),
  }
  const { ports, asked } = fakeCapacityPorts([], undefined, [window])
  await expect(judgePartnerCapacity(ports, {
    rideId,
    partnerId,
    pickupAt: at(10),
    landingAt: null,
  }, fleet({ partnerIds: [partnerId] }))).resolves.toMatchObject({ fullyBooked: true })
  expect(asked.ridesDuring).toEqual([])
  expect(asked.windows).toEqual([
    {
      driverIds: [],
      vehicleIds: [],
      partnerIds: [partnerId],
      from: at(10),
      to: at(11),
    },
    {
      driverIds: [],
      vehicleIds: [],
      partnerIds: [partnerId],
      from: at(10),
      to: at(11),
    },
  ])
})

it('refuses the board read to a driver before any fleet read', async () => {
  const active = fleet({ driverIds: [driverId], vehicleIds: [vehicleId] })
  await expect(readBoardFullyBooked(fakeCapacityPorts().ports, active, 'driver', {
    rides: [{ rideId, pickupAt: at(10), landingAt: null }],
    durationMinutes: 60,
  })).rejects.toMatchObject({ statusCode: 403 })
  expect(active.calls).toBe(0)
})
