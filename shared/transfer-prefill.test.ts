import { expect, it } from 'vitest'
import { duplicateTransferPrefill, extraVehicleGroupPassengers, extraVehiclePrefill, returnTransferPrefill } from './transfer-prefill'

/**
 * Duplicate and return journey (issue #260, ADR-0038). Expected values are
 * the booking the form should show. Neither result carries a Transfer id
 * or a Ride id: nothing is stored, and the model has no link.
 */

const CLIENT = '00000000-0000-4000-8000-000000000001'
const START = '00000000-0000-4000-8000-000000000002'
const END = '00000000-0000-4000-8000-000000000003'
const TRANSFER = '00000000-0000-4000-8000-000000000004'
const RIDE = '00000000-0000-4000-8000-000000000005'

/** 10:15 in Zagreb on 16 October 2026 (CEST, UTC+2). */
const PICKUP = '2026-10-16T08:15:00.000Z'

function ride() {
  return {
    transferId: TRANSFER,
    rideId: RIDE,
    clientId: CLIENT,
    pickupAt: PICKUP,
    startLocationId: START,
    endLocationId: END,
    passengerCount: 3,
    guestName: 'Ana Anić',
    price: '42.50',
    payment: 'invoice_to_agency' as const,
    flightNumber: 'OU384',
    airportMark: true,
    tabla: 'ANA',
    clientReference: 'V-19',
    luggageCount: 2,
    childSeatCount: 1,
    note: 'Nazovi recepciju',
  }
}

it('duplicates the booking and drops the Transfer and Ride ids', () => {
  const prefill = duplicateTransferPrefill(ride(), 'Europe/Zagreb', 'en')

  expect(prefill).toEqual({
    clientId: CLIENT,
    pickupWall: '2026-10-16T10:15',
    startLocationId: START,
    endLocationId: END,
    passengers: '3',
    guest: 'Ana Anić',
    price: '42.50',
    payment: 'invoice_to_agency',
    flight: 'OU384',
    airportMark: true,
    tabla: 'ANA',
    clientReference: 'V-19',
    luggage: '2',
    childSeats: '1',
    note: 'Nazovi recepciju',
  })
  expect(prefill).not.toHaveProperty('transferId')
  expect(prefill).not.toHaveProperty('rideId')
})

it('writes a Croatian price with a comma', () => {
  expect(duplicateTransferPrefill(ride(), 'Europe/Zagreb', 'hr').price).toBe('42,50')
})

it('swaps the route for a return and empties the time, the flight, and the tabla', () => {
  const prefill = returnTransferPrefill(ride(), 'hr')

  expect(prefill).toEqual({
    clientId: CLIENT,
    pickupWall: '',
    startLocationId: END,
    endLocationId: START,
    passengers: '3',
    guest: 'Ana Anić',
    price: '',
    payment: 'invoice_to_agency',
    flight: '',
    airportMark: false,
    tabla: '',
    clientReference: 'V-19',
    luggage: '2',
    childSeats: '1',
    note: '',
  })
  expect(prefill).not.toHaveProperty('transferId')
  expect(prefill).not.toHaveProperty('rideId')
})

it('treats a missing flight, tabla, reference, and note as empty text', () => {
  const source = {
    ...ride(),
    flightNumber: null,
    tabla: '',
    clientReference: null,
    note: null,
  }

  expect(duplicateTransferPrefill(source, 'Europe/Zagreb', 'en')).toMatchObject({
    flight: '',
    tabla: '',
    clientReference: '',
    note: '',
  })
  expect(returnTransferPrefill(source, 'en').clientReference).toBe('')
})

/**
 * An extra vehicle copies the booking the Client already ordered and
 * leaves the vehicle's own counts empty (issue #466, ADR-0054). The
 * Price is 0. Nothing here is a Transfer id: the form sends the main
 * Transfer beside this prefill.
 */
it('copies the shared booking for an extra vehicle and empties the counts, the note, and the price', () => {
  const prefill = extraVehiclePrefill(ride(), 'Europe/Zagreb')

  expect(prefill).toEqual({
    clientId: CLIENT,
    pickupWall: '2026-10-16T10:15',
    startLocationId: START,
    endLocationId: END,
    passengers: '',
    guest: 'Ana Anić',
    price: '0',
    payment: 'invoice_to_agency',
    flight: 'OU384',
    airportMark: true,
    tabla: 'ANA',
    clientReference: 'V-19',
    luggage: '',
    childSeats: '',
    note: '',
  })
  expect(prefill).not.toHaveProperty('transferId')
  expect(prefill).not.toHaveProperty('rideId')
  expect(extraVehiclePrefill({
    ...ride(),
    flightNumber: null,
    clientReference: null,
    tabla: '',
  }, 'Europe/Zagreb')).toMatchObject({
    flight: '',
    tabla: '',
    clientReference: '',
    price: '0',
  })
})

it('asks for the group count only while the main Transfer has not stored one', () => {
  expect(extraVehicleGroupPassengers(false, 3)).toBe('3')
  expect(extraVehicleGroupPassengers(true, 3)).toBeNull()
})
