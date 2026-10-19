import { expect, it } from 'vitest'
import { fakeCapacityPorts } from '../testing'
import { readBoardUnavailability } from './board-unavailability'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherVehicleId = 'c2c2c2c2-2222-4222-8222-222222222222'
const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const laterRideId = 'e2e2e2e2-3333-4333-8333-333333333333'

function at(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

const rides = [
  { rideId, driverId, vehicleId, pickupAt: at(8), landingAt: null },
  { rideId: laterRideId, driverId, vehicleId: otherVehicleId, pickupAt: at(14), landingAt: at(15) },
]

function away(startsAt: Date, endsAt: Date, owner: { driverId?: string, vehicleId?: string }) {
  return { id: 'a1a1a1a1-1111-4111-8111-111111111111', driverId: owner.driverId ?? null, vehicleId: owner.vehicleId ?? null, startsAt, endsAt }
}

it('asks once for the windows of the listed resources across the Rides\' occupied windows', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await readBoardUnavailability(ports.windows, 'dispatcher', { rides, durationMinutes: 60 })
  expect(asked.windows).toEqual([{
    driverIds: [driverId],
    vehicleIds: [vehicleId, otherVehicleId],
    from: at(8),
    to: at(16),
  }])
})

it('names the covered resources per Ride and leaves an uncovered Ride out', async () => {
  const { ports } = fakeCapacityPorts([], undefined, [away(at(8, 30), at(9), { vehicleId })])
  const unavailable = await readBoardUnavailability(ports.windows, 'admin', { rides, durationMinutes: 60 })
  expect([...unavailable]).toEqual([[rideId, ['vehicle']]])
})

it('reads nothing when no Ride holds a Driver and a Vehicle', async () => {
  const { ports, asked } = fakeCapacityPorts()
  const unavailable = await readBoardUnavailability(ports.windows, 'admin', {
    rides: [{ rideId, driverId: null, vehicleId: null, pickupAt: at(8), landingAt: null }],
    durationMinutes: 60,
  })
  expect(unavailable.size).toBe(0)
  expect(asked.windows).toEqual([])
})

it('refuses a Driver role', async () => {
  const { ports } = fakeCapacityPorts()
  await expect(readBoardUnavailability(ports.windows, 'driver', { rides, durationMinutes: 60 })).rejects.toMatchObject({ statusCode: 403 })
})
