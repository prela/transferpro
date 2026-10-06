import { expect, it } from 'vitest'
import { QueryParamError } from './query'
import { CHILD_SEAT_COUNT_MAX, FLIGHT_NUMBER_MAX_LENGTH, GUEST_NAME_MAX_LENGTH, LUGGAGE_COUNT_MAX, NOTE_MAX_LENGTH, parseCreateTransfer, parseTransferDay, PASSENGER_COUNT_MAX, priceError, TransferInputError } from './transfer'

const clientId = '9e4b3f6d-5555-4555-8555-555555555555'
const startLocationId = 'a1b2c3d4-5555-4555-8555-555555555555'
const endLocationId = 'b1b2c3d4-6666-4666-8666-666666666666'
const guest = 'Ana Anić'
const flight = 'OU 384'
const note = 'Čeka na terminalu'

const body = {
  clientId,
  pickupAt: '2026-10-06T22:30:00.000Z',
  startLocationId,
  endLocationId,
  passengerCount: 2,
  guestName: `  ${guest}  `,
  price: 42.5,
  payment: 'cash' as const,
  airportMark: false,
  luggageCount: 1,
  childSeatCount: 0,
}

it('accepts a Transfer, trims the guest name, and stores a blank flight and note as null', () => {
  expect(parseCreateTransfer(body)).toEqual({
    clientId,
    pickupAt: '2026-10-06T22:30:00.000Z',
    startLocationId,
    endLocationId,
    passengerCount: 2,
    guestName: guest,
    flightNumber: null,
    price: '42.50',
    payment: 'cash',
    airportMark: false,
    luggageCount: 1,
    childSeatCount: 0,
    note: null,
  })
})

it('keeps a flight number without turning it into an airport pickup', () => {
  const parsed = parseCreateTransfer({
    ...body,
    flightNumber: `  ${flight}  `,
    airportMark: false,
    payment: 'invoice_to_agency',
    price: 0,
    note: `  ${note}  `,
  })
  expect(parsed.flightNumber).toBe(flight)
  expect(parsed.airportMark).toBe(false)
  expect(parsed.payment).toBe('invoice_to_agency')
  expect(parsed.price).toBe('0.00')
  expect(parsed.note).toBe(note)
})

it('refuses a bad fare, a long guest name, an extra key, and a missing airport mark', () => {
  expect(() => parseCreateTransfer({ ...body, price: -1 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, price: 100_000_000 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, price: 1.001 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, guestName: '   ' })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, guestName: 'A'.repeat(GUEST_NAME_MAX_LENGTH + 1) })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, flightNumber: 'A'.repeat(FLIGHT_NUMBER_MAX_LENGTH + 1) })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, note: 'A'.repeat(NOTE_MAX_LENGTH + 1) })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, passengerCount: 0 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, passengerCount: PASSENGER_COUNT_MAX + 1 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, luggageCount: LUGGAGE_COUNT_MAX + 1 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, childSeatCount: CHILD_SEAT_COUNT_MAX + 1 })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, payment: 'invoice' })).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, airportMark: 'true' })).toThrow(TransferInputError)
  const { airportMark: _mark, ...withoutMark } = body
  expect(() => parseCreateTransfer(withoutMark)).toThrow(TransferInputError)
  expect(() => parseCreateTransfer({ ...body, address: 'Dobrota' })).toThrow(TransferInputError)
})

it('treats a missing day as today and refuses a day that is not a calendar date', () => {
  expect(parseTransferDay(undefined)).toBeNull()
  expect(parseTransferDay('2026-10-07')).toBe('2026-10-07')
  expect(() => parseTransferDay('')).toThrow(QueryParamError)
  expect(() => parseTransferDay('2026-02-31')).toThrow(QueryParamError)
  expect(() => parseTransferDay('06.10.2026')).toThrow(QueryParamError)
})

it('accepts a comma as a decimal mark and refuses a third digit', () => {
  expect(priceError('12,5')).toBeNull()
  expect(priceError('0')).toBeNull()
  expect(priceError('')).toBe('invalid')
  expect(priceError('-1')).toBe('invalid')
  expect(priceError('1.001')).toBe('invalid')
})
