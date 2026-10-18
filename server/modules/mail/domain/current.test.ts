import { expect, it } from 'vitest'
import { workOrderIsCurrent } from './current'

const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const otherDriverId = 'b2b2b2b2-2222-4222-8222-222222222222'
const pickupAt = new Date('2026-10-18T12:00:00.000Z')
const beforePickup = new Date('2026-10-18T11:59:59.000Z')
const atPickup = new Date('2026-10-18T12:00:00.000Z')

function facts(overrides: Partial<Parameters<typeof workOrderIsCurrent>[0]> = {}) {
  return {
    status: 'assigned' as const,
    driverId,
    rideDriverId: driverId,
    rideFinished: false,
    pickupAt,
    now: beforePickup,
    ...overrides,
  }
}

it('keeps an assigned or changed work order while that Driver still has the Ride', () => {
  expect(workOrderIsCurrent(facts())).toBe(true)
  expect(workOrderIsCurrent(facts({ status: 'changed' }))).toBe(true)
})

it('drops an assigned or changed work order when the Driver changed, and keeps it when the Ride comes back', () => {
  expect(workOrderIsCurrent(facts({ rideDriverId: otherDriverId }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', rideDriverId: null }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', rideDriverId: driverId }))).toBe(true)
})

it('drops an assigned or changed work order when the Ride is finished or the pickup has passed', () => {
  expect(workOrderIsCurrent(facts({ rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ now: atPickup }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', now: new Date('2026-10-18T12:00:01.000Z') }))).toBe(false)
})

it('keeps no longer yours until that Driver has the Ride again or the pickup has passed', () => {
  expect(workOrderIsCurrent(facts({
    status: 'no_longer_yours',
    rideDriverId: otherDriverId,
  }))).toBe(true)
  expect(workOrderIsCurrent(facts({
    status: 'no_longer_yours',
    rideDriverId: null,
    rideFinished: true,
  }))).toBe(true)
  expect(workOrderIsCurrent(facts({
    status: 'no_longer_yours',
    rideDriverId: driverId,
  }))).toBe(false)
  expect(workOrderIsCurrent(facts({
    status: 'no_longer_yours',
    rideDriverId: null,
    now: atPickup,
  }))).toBe(false)
})

it('keeps a cancelled work order until the pickup has passed', () => {
  expect(workOrderIsCurrent(facts({
    status: 'cancelled',
    rideDriverId: otherDriverId,
    rideFinished: true,
  }))).toBe(true)
  expect(workOrderIsCurrent(facts({
    status: 'cancelled',
    now: atPickup,
  }))).toBe(false)
})
