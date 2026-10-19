import { expect, it } from 'vitest'
import { localDayBounds } from '../../../../shared'
import { TenantAccessError } from '../../tenancy'
import { fakeCapacityPorts } from '../testing'
import { readBoardOccupation } from './board'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'
const otherId = 'e2e2e2e2-3333-4333-8333-333333333333'
const hour = 60 * 60 * 1000
const day = { day: '2026-10-19', timeZone: 'Europe/Zagreb', startHour: 5 }
const bounds = localDayBounds(day.day, day.timeZone, day.startHour)
const pickupAt = new Date('2026-10-19T08:00:00.000Z')

it('asks the port for the listed Drivers and Vehicles across the board day plus its reach', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await readBoardOccupation(ports.occupation, 'dispatcher', {
    ...day,
    rides: [
      { driverId, vehicleId, pickupAt, landingAt: null },
      { driverId, vehicleId: null, pickupAt, landingAt: null },
      { driverId: otherDriverId, vehicleId: null, pickupAt, landingAt: null },
    ],
  })
  expect(asked.ridesDuring).toEqual([{
    of: { driverIds: [driverId, otherDriverId], vehicleIds: [vehicleId], partnerIds: [] },
    from: new Date(bounds.start.getTime() - 48 * hour),
    to: new Date(bounds.end.getTime() + 48 * hour),
  }])
  expect(asked.ridesOf).toEqual([])
})

it('answers with the occupied windows the board judges, without the Partner id', async () => {
  const { ports } = fakeCapacityPorts([{ rideId: otherId, driverId, vehicleId, partnerId: null, pickupAt, landingAt: null }])
  await expect(readBoardOccupation(ports.occupation, 'admin', {
    ...day,
    rides: [{ driverId, vehicleId, pickupAt, landingAt: null }],
  })).resolves.toEqual([{ rideId: otherId, driverId, vehicleId, pickupAt, landingAt: null }])
})

it('asks nothing when no listed Ride has a Driver or a Vehicle', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(readBoardOccupation(ports.occupation, 'dispatcher', {
    ...day,
    rides: [{ driverId: null, vehicleId: null, pickupAt, landingAt: null }],
  })).resolves.toEqual([])
  expect(asked.ridesDuring).toEqual([])
})

it('refuses a driver before it asks the port', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(readBoardOccupation(ports.occupation, 'driver', {
    ...day,
    rides: [{ driverId, vehicleId, pickupAt, landingAt: null }],
  })).rejects.toBeInstanceOf(TenantAccessError)
  expect(asked.ridesDuring).toEqual([])
})
