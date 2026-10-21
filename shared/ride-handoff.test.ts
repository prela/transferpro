import { expect, it } from 'vitest'
import { RideCommandInputError } from './ride-assignment'
import { canChangeHandedOffPartner, canCloseHandedOffRide, canHandOffRide, canTakeBackHandedOffRide, parseChangeRidePartner, parseHandOffRide, parseTakeBackRide } from './ride-handoff'

const rideId = '11111111-1111-4111-8111-111111111111'
const partnerId = '22222222-2222-4222-8222-222222222222'

it('accepts a handoff from unassigned, assigned, or accepted only', () => {
  expect(canHandOffRide('unassigned')).toBe(true)
  expect(canHandOffRide('assigned')).toBe(true)
  expect(canHandOffRide('accepted')).toBe(true)
  expect(canHandOffRide('handed_off')).toBe(false)
  expect(canHandOffRide('done')).toBe(false)
  expect(canChangeHandedOffPartner('handed_off')).toBe(true)
  expect(canChangeHandedOffPartner('unassigned')).toBe(false)
  expect(canTakeBackHandedOffRide('handed_off')).toBe(true)
  expect(canTakeBackHandedOffRide('assigned')).toBe(false)
  expect(canCloseHandedOffRide('handed_off')).toBe(true)
  expect(canCloseHandedOffRide('accepted')).toBe(false)
})

it('parses a partner command with a version, and refuses an extra key or a missing version', () => {
  expect(parseHandOffRide(rideId, { partnerId, version: 0 })).toEqual({ rideId, partnerId, version: 0 })
  expect(parseChangeRidePartner(rideId, { partnerId, version: 3 })).toEqual({ rideId, partnerId, version: 3 })
  expect(() => parseHandOffRide(rideId, { partnerId })).toThrow(RideCommandInputError)
  expect(() => parseHandOffRide(rideId, { partnerId, version: 0, confirm: true })).toThrow(RideCommandInputError)
  expect(() => parseHandOffRide('not-a-ride', { partnerId, version: 0 })).toThrow(RideCommandInputError)
  expect(() => parseChangeRidePartner(rideId, { partnerId, version: 1, phone: '+385911111111' })).toThrow(RideCommandInputError)
})

it('parses a take-back version, and refuses a missing one', () => {
  expect(parseTakeBackRide(rideId, { version: 2 })).toEqual({ rideId, version: 2 })
  expect(() => parseTakeBackRide(rideId, {})).toThrow(RideCommandInputError)
  expect(() => parseTakeBackRide(rideId, { version: 2, partnerId })).toThrow(RideCommandInputError)
})
