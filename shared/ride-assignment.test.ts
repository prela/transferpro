import { expect, it } from 'vitest'
import { ASSIGNMENT_REFUSED_STATES, AssignRideInputError, assignTransitionAllowed, copiedMustAccept, parseAssignRide, parseRosterVehicleRead } from './ride-assignment'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'

it('requires a Ride, a Driver, and a Vehicle together', () => {
  expect(parseAssignRide({ rideId, driverId, vehicleId })).toEqual({ rideId, driverId, vehicleId })
  expect(() => parseAssignRide({ rideId, driverId })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, vehicleId })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ driverId, vehicleId })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, driverId, vehicleId, plate: 'ZG1001AA' })).toThrow(AssignRideInputError)
  expect(() => parseRosterVehicleRead(rideId, undefined)).toThrow(AssignRideInputError)
  expect(() => parseRosterVehicleRead('not-a-ride', driverId)).toThrow(AssignRideInputError)
  expect(parseRosterVehicleRead(rideId, driverId)).toEqual({ rideId, driverId })
})

it('allows the transition only from unassigned', () => {
  expect(assignTransitionAllowed('unassigned')).toBe(true)
  expect(assignTransitionAllowed('teleported')).toBe(false)
  for (const state of ASSIGNMENT_REFUSED_STATES)
    expect(assignTransitionAllowed(state)).toBe(false)
})

it('copies the must-accept setting as a value, so a later Driver change is a different copy', () => {
  const atAssignment = copiedMustAccept(true)
  const afterTheDriverChanges = copiedMustAccept(false)
  expect(atAssignment).toBe(true)
  expect(afterTheDriverChanges).toBe(false)
  expect(copiedMustAccept(false)).toBe(false)
})
