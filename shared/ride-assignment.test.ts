import { expect, it } from 'vitest'
import { ASSIGNMENT_REFUSED_STATES, AssignRideInputError, assignTransitionAllowed, parseAssignRide, parseChangeRideVehicle, parseClearRide, parseReassignRide, parseRosterVehicleRead, rideChangeAllowed, RideCommandInputError } from './ride-assignment'
import { RIDE_STATES } from './transfer'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const driverId = 'b1b1b1b1-1111-4111-8111-111111111111'
const vehicleId = 'c1c1c1c1-1111-4111-8111-111111111111'

it('requires a Ride, a Driver, a Vehicle, and the opened version together', () => {
  expect(parseAssignRide({ rideId, driverId, vehicleId, version: 0 })).toEqual({ rideId, driverId, vehicleId, version: 0 })
  expect(() => parseAssignRide({ rideId, driverId, vehicleId })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, driverId, version: 0 })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, vehicleId, version: 0 })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ driverId, vehicleId, version: 0 })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, driverId, vehicleId, version: 0, plate: 'ZG1001AA' })).toThrow(AssignRideInputError)
  expect(() => parseAssignRide({ rideId, driverId, vehicleId, version: 1.5 })).toThrow(AssignRideInputError)
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

it('parses a vehicle change, a clear, and a reassignment, and refuses a plate or a missing version', () => {
  expect(parseChangeRideVehicle({ rideId, vehicleId, version: 1 })).toEqual({ rideId, vehicleId, version: 1 })
  expect(() => parseChangeRideVehicle({ rideId, vehicleId })).toThrow(RideCommandInputError)
  expect(() => parseChangeRideVehicle({ rideId, vehicleId, version: 1, driverId })).toThrow(RideCommandInputError)
  expect(() => parseChangeRideVehicle({ rideId, vehicleId, version: 1, plate: 'ZG1001AA' })).toThrow(RideCommandInputError)
  expect(() => parseChangeRideVehicle({ rideId, version: 1 })).toThrow(RideCommandInputError)

  expect(parseClearRide(rideId, { version: 2 })).toEqual({ rideId, version: 2 })
  expect(() => parseClearRide(rideId, {})).toThrow(RideCommandInputError)
  expect(() => parseClearRide(rideId, undefined)).toThrow(RideCommandInputError)
  expect(() => parseClearRide(rideId, { version: 2, driverId })).toThrow(RideCommandInputError)
  expect(() => parseClearRide('not-a-ride', { version: 2 })).toThrow(RideCommandInputError)

  expect(parseReassignRide({ rideId, driverId, vehicleId, version: 3 })).toEqual({ rideId, driverId, vehicleId, version: 3 })
  expect(() => parseReassignRide({ rideId, driverId, vehicleId })).toThrow(RideCommandInputError)
  expect(() => parseReassignRide({ rideId, driverId, version: 3 })).toThrow(RideCommandInputError)
  expect(() => parseReassignRide({ rideId, vehicleId, version: 3 })).toThrow(RideCommandInputError)
  expect(() => parseReassignRide({ rideId, driverId, vehicleId, version: 3, phone: '+38591111' })).toThrow(RideCommandInputError)
})

it('allows a vehicle change, a clear, and a reassignment only from assigned or accepted', () => {
  expect(rideChangeAllowed('assigned')).toBe(true)
  expect(rideChangeAllowed('accepted')).toBe(true)
  expect(rideChangeAllowed('teleported')).toBe(false)
  for (const state of RIDE_STATES) {
    if (state === 'assigned' || state === 'accepted')
      continue
    expect(rideChangeAllowed(state)).toBe(false)
  }
})
