import { expect, it } from 'vitest'
import { ASSIGNMENT_REFUSED_STATES, AssignRideInputError, assignTransitionAllowed, parseAssignRide, parseChangeRideVehicle, parseClearRide, parseReassignRide, parseRosterVehicleRead, rideChangeAllowed, RideCommandInputError } from './ride-assignment'
import { RIDE_STATES } from './transfer'

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

it('parses a vehicle change, a clear, and a reassignment, and refuses a plate or a missing id', () => {
  expect(parseChangeRideVehicle({ rideId, vehicleId })).toEqual({ rideId, vehicleId })
  expect(() => parseChangeRideVehicle({ rideId, vehicleId, driverId })).toThrow(RideCommandInputError)
  expect(() => parseChangeRideVehicle({ rideId, vehicleId, plate: 'ZG1001AA' })).toThrow(RideCommandInputError)
  expect(() => parseChangeRideVehicle({ rideId })).toThrow(RideCommandInputError)

  expect(parseClearRide(rideId, {})).toBe(rideId)
  expect(parseClearRide(rideId, undefined)).toBe(rideId)
  expect(() => parseClearRide(rideId, { driverId })).toThrow(RideCommandInputError)
  expect(() => parseClearRide('not-a-ride', {})).toThrow(RideCommandInputError)

  expect(parseReassignRide({ rideId, driverId, vehicleId })).toEqual({ rideId, driverId, vehicleId })
  expect(() => parseReassignRide({ rideId, driverId })).toThrow(RideCommandInputError)
  expect(() => parseReassignRide({ rideId, vehicleId })).toThrow(RideCommandInputError)
  expect(() => parseReassignRide({ rideId, driverId, vehicleId, phone: '+38591111' })).toThrow(RideCommandInputError)
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
