import { z } from 'zod'
import { isCalendarDate } from './date'
import { QueryParamError } from './query'

/**
 * A price is EUR, stored as numeric(10, 2). Zero is a free ride. A day of
 * digits is too long for a fare and is refused. The currency is not a column.
 */
export const TRANSFER_PRICE_MAX = 99_999_999.99

/** One vehicle. Sixty is a coach, not a pasted spreadsheet. */
export const PASSENGER_COUNT_MIN = 1
export const PASSENGER_COUNT_MAX = 60

export const LUGGAGE_COUNT_MIN = 0
export const LUGGAGE_COUNT_MAX = 60

/** A few seats in the boot, not a count of children. */
export const CHILD_SEAT_COUNT_MIN = 0
export const CHILD_SEAT_COUNT_MAX = 10

/** A guest name, not a paragraph. Same bound as a Client name. */
export const GUEST_NAME_MAX_LENGTH = 200

/** A flight code, plain text. It does not decide the airport mark. */
export const FLIGHT_NUMBER_MAX_LENGTH = 20

/** A note for the office. Longer than that is a document, not a note. */
export const NOTE_MAX_LENGTH = 1000

/**
 * ADR-0005. This slice writes only `unassigned`. The other labels are reserved
 * so a later assignment does not have to widen the check first.
 */
export const RIDE_STATES = ['unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled'] as const

/**
 * How the Transfer will be paid. `invoice_to_agency` is a recorded choice.
 * Invoicing is not v1. ADR-0020 (proposed) extends ADR-0009: the Driver
 * sees the price and the payment method only for cash. Card and invoice
 * to agency hide both. That phone rule is not this slice.
 */
export const PAYMENT_METHODS = ['cash', 'card', 'invoice_to_agency'] as const

/**
 * The only strings an audit row may store for a Transfer. Values (the guest
 * name, the flight, the note, the price) are not in this list.
 */
export const TRANSFER_FIELDS = [
  'pickupAt',
  'passengerCount',
  'guestName',
  'flightNumber',
  'price',
  'payment',
  'airportMark',
  'luggageCount',
  'childSeatCount',
  'note',
] as const

export const rideStateSchema = z.enum(RIDE_STATES)

export type RideState = z.infer<typeof rideStateSchema>

export const paymentMethodSchema = z.enum(PAYMENT_METHODS)

export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const transferFieldSchema = z.enum(TRANSFER_FIELDS)

export type TransferField = z.infer<typeof transferFieldSchema>

/** Two decimal places, from zero up to {@link TRANSFER_PRICE_MAX}. */
export const transferPriceSchema = z.string().regex(/^\d{1,8}\.\d{2}$/).refine((value) => {
  const cents = priceCents(Number(value))
  return cents !== null && formatPriceCents(cents) === value
})

const guestNameSchema = z.string().trim().min(1).max(GUEST_NAME_MAX_LENGTH)

/**
 * Blank becomes null. Surrounding spaces are dropped. The stored value is
 * never an empty string.
 */
function optionalLine(maxLength: number) {
  return z.union([
    z.null(),
    z.string().transform((value) => {
      const trimmed = value.trim()
      return trimmed === '' ? null : trimmed
    }).pipe(z.string().max(maxLength).nullable()),
  ])
}

const flightNumberSchema = optionalLine(FLIGHT_NUMBER_MAX_LENGTH)
const noteSchema = optionalLine(NOTE_MAX_LENGTH)

export const transferSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  pickupAt: z.iso.datetime(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  guestName: guestNameSchema,
  flightNumber: z.string().min(1).max(FLIGHT_NUMBER_MAX_LENGTH).nullable(),
  price: transferPriceSchema,
  payment: paymentMethodSchema,
  airportMark: z.boolean(),
  luggageCount: z.number().int().min(LUGGAGE_COUNT_MIN).max(LUGGAGE_COUNT_MAX),
  childSeatCount: z.number().int().min(CHILD_SEAT_COUNT_MIN).max(CHILD_SEAT_COUNT_MAX),
  note: z.string().min(1).max(NOTE_MAX_LENGTH).nullable(),
})

export type Transfer = z.infer<typeof transferSchema>

/** The one Ride this slice creates. Driver and Vehicle stay null until #19. */
export const rideSchema = z.object({
  id: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
})

export type Ride = z.infer<typeof rideSchema>

export const recordedTransferSchema = z.object({
  transfer: transferSchema,
  ride: rideSchema,
})

export type RecordedTransfer = z.infer<typeof recordedTransferSchema>

/** One row of the day list: the Ride and the Transfer it executes. */
export const transferDayRideSchema = transferSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
})

export type TransferDayRide = z.infer<typeof transferDayRideSchema>

export const transferDaySchema = z.object({
  date: z.string().refine(isCalendarDate),
  rides: z.array(transferDayRideSchema),
})

export type TransferDay = z.infer<typeof transferDaySchema>

/**
 * POST /api/transfers. The airport mark is required, so a flight number
 * cannot stand in for it. An unknown key is refused.
 */
export const createTransferSchema = z.strictObject({
  clientId: z.uuid(),
  pickupAt: z.iso.datetime(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  guestName: guestNameSchema,
  flightNumber: flightNumberSchema.optional(),
  price: z.number().finite().refine(value => priceCents(value) !== null),
  payment: paymentMethodSchema,
  airportMark: z.boolean(),
  luggageCount: z.number().int().min(LUGGAGE_COUNT_MIN).max(LUGGAGE_COUNT_MAX),
  childSeatCount: z.number().int().min(CHILD_SEAT_COUNT_MIN).max(CHILD_SEAT_COUNT_MAX),
  note: noteSchema.optional(),
})

export interface CreateTransfer {
  readonly clientId: string
  readonly pickupAt: string
  readonly startLocationId: string
  readonly endLocationId: string
  readonly passengerCount: number
  readonly guestName: string
  readonly flightNumber: string | null
  readonly price: string
  readonly payment: PaymentMethod
  readonly airportMark: boolean
  readonly luggageCount: number
  readonly childSeatCount: number
  readonly note: string | null
}

/** The body was not a valid Transfer. Nothing is written. The guest name is not in the message. */
export class TransferInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'TransferInputError'
  }
}

/** Accepts a new Transfer. Any other body throws first, so the caller does not open a session. */
export function parseCreateTransfer(raw: unknown): CreateTransfer {
  const parsed = createTransferSchema.safeParse(raw)
  if (!parsed.success)
    throw new TransferInputError()
  const cents = priceCents(parsed.data.price)
  if (cents === null)
    throw new TransferInputError()
  return {
    clientId: parsed.data.clientId,
    pickupAt: parsed.data.pickupAt,
    startLocationId: parsed.data.startLocationId,
    endLocationId: parsed.data.endLocationId,
    passengerCount: parsed.data.passengerCount,
    guestName: parsed.data.guestName,
    flightNumber: parsed.data.flightNumber === undefined ? null : parsed.data.flightNumber,
    price: formatPriceCents(cents),
    payment: parsed.data.payment,
    airportMark: parsed.data.airportMark,
    luggageCount: parsed.data.luggageCount,
    childSeatCount: parsed.data.childSeatCount,
    note: parsed.data.note === undefined ? null : parsed.data.note,
  }
}

/**
 * GET /api/transfers `date`. Absent means today in the Tenant time zone.
 * Anything else that is not `YYYY-MM-DD` is refused before a session opens.
 */
export function parseTransferDay(raw: unknown): string | null {
  if (raw === undefined)
    return null
  if (typeof raw !== 'string' || !isCalendarDate(raw))
    throw new QueryParamError()
  return raw
}

export type GuestNameError = 'empty' | 'too-long'
export type LineError = 'too-long'
export type PriceError = 'invalid'
export type CountError = 'invalid'

/** What the record form can tell the person before a request. */
export function guestNameError(value: string): GuestNameError | null {
  const trimmed = value.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (trimmed.length > GUEST_NAME_MAX_LENGTH)
    return 'too-long'
  return null
}

export function flightNumberError(value: string): LineError | null {
  return value.trim().length > FLIGHT_NUMBER_MAX_LENGTH ? 'too-long' : null
}

export function noteError(value: string): LineError | null {
  return value.trim().length > NOTE_MAX_LENGTH ? 'too-long' : null
}

/** A fare typed as a number. A comma is a decimal mark. More than two places is refused. */
export function priceError(value: string): PriceError | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    return 'invalid'
  return priceCents(Number(normalized)) === null ? 'invalid' : null
}

export function priceFromInput(value: string): number {
  const normalized = value.trim().replace(',', '.')
  return Number(normalized)
}

function countError(value: string, min: number, max: number): CountError | null {
  if (!/^\d+$/.test(value.trim()))
    return 'invalid'
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    return 'invalid'
  return null
}

export function passengerCountError(value: string): CountError | null {
  return countError(value, PASSENGER_COUNT_MIN, PASSENGER_COUNT_MAX)
}

export function luggageCountError(value: string): CountError | null {
  return countError(value, LUGGAGE_COUNT_MIN, LUGGAGE_COUNT_MAX)
}

export function childSeatCountError(value: string): CountError | null {
  return countError(value, CHILD_SEAT_COUNT_MIN, CHILD_SEAT_COUNT_MAX)
}

/**
 * Cents, so 0.1 and 0.2 do not become a third digit. Null when the number
 * is not a non-negative two-decimal fare inside numeric(10, 2).
 */
function priceCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > TRANSFER_PRICE_MAX)
    return null
  const cents = Math.round(value * 100)
  if (Math.abs(value * 100 - cents) > 1e-6)
    return null
  return cents
}

function formatPriceCents(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const fraction = String(cents % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}
