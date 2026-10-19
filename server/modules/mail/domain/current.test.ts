import { expect, it } from 'vitest'
import { invitationIsCurrent, workOrderIsCurrent } from './current'

function facts(overrides: Partial<Parameters<typeof workOrderIsCurrent>[0]> = {}) {
  return {
    status: 'assigned' as const,
    rideFinished: false,
    rideCancelled: false,
    superseded: false,
    ...overrides,
  }
}

it('keeps a work order that nothing has replaced, including after the pickup and after a driver change', () => {
  expect(workOrderIsCurrent(facts())).toBe(true)
  expect(workOrderIsCurrent(facts({ status: 'changed' }))).toBe(true)
  expect(workOrderIsCurrent(facts({ status: 'no_longer_yours' }))).toBe(true)
})

it('drops a work order when the Ride is finished, and when a cancel stales assigned or changed mail', () => {
  expect(workOrderIsCurrent(facts({ rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'no_longer_yours', rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'cancelled', rideFinished: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ rideCancelled: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', rideCancelled: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'cancelled', rideCancelled: true }))).toBe(true)
})

it('keeps no longer yours after the Ride is cancelled, and drops it when that Driver gets a newer work order', () => {
  expect(workOrderIsCurrent(facts({ status: 'no_longer_yours', rideCancelled: true }))).toBe(true)
  expect(workOrderIsCurrent(facts({ status: 'no_longer_yours', rideCancelled: true, superseded: true }))).toBe(false)
})

it('drops a work order when a newer one for the same Ride and the same Driver replaced it, including a cancellation notice', () => {
  expect(workOrderIsCurrent(facts({ superseded: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'changed', superseded: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'no_longer_yours', superseded: true }))).toBe(false)
  expect(workOrderIsCurrent(facts({ status: 'cancelled', rideCancelled: true, superseded: true }))).toBe(false)
})

const now = new Date('2026-10-19T10:00:00.000Z')
const tomorrow = new Date('2026-10-20T10:00:00.000Z')

it('keeps an invitation while it is pending and not yet expired', () => {
  expect(invitationIsCurrent({ status: 'pending', expiresAt: tomorrow }, now)).toBe(true)
})

it('drops an invitation that was accepted, revoked, rejected, expired, or is gone', () => {
  expect(invitationIsCurrent({ status: 'accepted', expiresAt: tomorrow }, now)).toBe(false)
  expect(invitationIsCurrent({ status: 'canceled', expiresAt: tomorrow }, now)).toBe(false)
  expect(invitationIsCurrent({ status: 'rejected', expiresAt: tomorrow }, now)).toBe(false)
  expect(invitationIsCurrent({ status: 'pending', expiresAt: now }, now)).toBe(false)
  expect(invitationIsCurrent({ status: 'pending', expiresAt: new Date(now.getTime() - 1) }, now)).toBe(false)
  expect(invitationIsCurrent(null, now)).toBe(false)
})
