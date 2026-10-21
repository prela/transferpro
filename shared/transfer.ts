import { z } from 'zod'
import { boardWarningsSchema } from './board-warnings'
import { isCalendarDate } from './date'
import { sameFlightDesignator } from './flight-landing'
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
 * Words on the meet sign for this pickup. Same bound as a guest name.
 * A blank is stored as empty text, not as null, so the column is always present.
 */
export const TABLA_MAX_LENGTH = 200

/**
 * The Client's own booking number. A line, not a note: the same bound as a
 * guest name. It is optional and not unique (ADR-0003).
 */
export const CLIENT_REFERENCE_MAX_LENGTH = 200

/**
 * Look-back for a pickup instant: 30 × 24 hours from `now` (720 hours), not
 * 30 calendar days in the Tenant time zone. DST and local midnight do not
 * move the edge. The forward bound is {@link PICKUP_FUTURE_MONTHS} UTC
 * calendar months (see {@link addUtcMonths}).
 */
export const PICKUP_PAST_DAYS = 30

/** A pickup later than this many UTC calendar months after now is refused. */
export const PICKUP_FUTURE_MONTHS = 18

/**
 * ADR-0005. Creating a Transfer writes `unassigned`. Assignment writes
 * `assigned`. Acceptance writes `accepted`. Done writes `done`.
 * `no-show` and `cancelled` stay reserved for later commands.
 */
export const RIDE_STATES = ['unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled'] as const

/**
 * How the Transfer will be paid. `invoice_to_agency` is a recorded choice.
 * Invoicing is not v1. ADR-0020 extends ADR-0009: the Driver
 * sees the price and the payment method only for cash. Card and invoice
 * to agency hide both. The phone list applies that in `presentDriverRide`.
 */
export const PAYMENT_METHODS = ['cash', 'card', 'invoice_to_agency'] as const

/**
 * The only strings an audit row may store for a Transfer. Values (the guest
 * name, the flight, the note, the tabla text, the Client reference, the price)
 * are not in this list.
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
  'tabla',
  'clientReference',
] as const

export const rideStateSchema = z.enum(RIDE_STATES)

export type RideState = z.infer<typeof rideStateSchema>

/**
 * ADR-0006. The copied flag is the one stored on the Ride.
 * Off: done is reachable from `assigned`. On: done is reachable only from
 * `accepted`. Every other pair, including a second done, is refused.
 */
export function canMarkRideDone(state: RideState, mustAccept: boolean | null): boolean {
  return (state === 'assigned' && mustAccept === false) || (state === 'accepted' && mustAccept === true)
}

/**
 * ADR-0005. A dispatcher or an admin may cancel from `unassigned`,
 * `assigned`, or `accepted`. The copied flag does not matter. `done`,
 * `no-show`, and a second cancel are terminal and are refused.
 */
export function canCancelRide(state: RideState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted'
}

/**
 * ADR-0007 and ADR-0028. A landing time can be recorded or cleared while the
 * Ride is unfinished, including before anyone is assigned. `done`, `no-show`,
 * and `cancelled` keep the time they already have. The Ride state is not a
 * landing-time change.
 */
export function canRecordLandingTime(state: RideState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted'
}

/**
 * ADR-0010. A dispatcher or an admin may correct the booking while the Ride
 * is unfinished. `done`, `no-show`, and `cancelled` keep the details they have.
 */
export function canCorrectTransfer(state: RideState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted'
}

/**
 * Field names a correction may store. The Client and the two Locations are
 * ids on the row as well, and a change of either is still a field name.
 * A guest name, a flight number, a note, a tabla, a Client reference, or a
 * price is not a name in this list: those values stay on the Transfer.
 */
export const TRANSFER_CORRECTION_FIELDS = [
  'clientId',
  'pickupAt',
  'startLocationId',
  'endLocationId',
  ...TRANSFER_FIELDS.filter(field => field !== 'pickupAt'),
] as const

export const transferCorrectionFieldSchema = z.enum(TRANSFER_CORRECTION_FIELDS)

export type TransferCorrectionField = z.infer<typeof transferCorrectionFieldSchema>

/**
 * The four facts the Driver accepted. Any other booking field leaves an
 * accepted Ride accepted (ADR-0010).
 */
const MATERIAL_TRANSFER_FIELDS = ['pickupAt', 'startLocationId', 'endLocationId', 'flightNumber'] as const

/**
 * Names that differ between the stored booking and the correction.
 * Pickup times match as instants, so a different ISO spelling of the same
 * moment is not a change. The order is {@link TRANSFER_CORRECTION_FIELDS}.
 */
export function changedTransferFields(before: CreateTransfer, after: CreateTransfer): TransferCorrectionField[] {
  return TRANSFER_CORRECTION_FIELDS.filter(field => !sameTransferField(field, before, after))
}

/**
 * An accepted Ride returns to assigned only when the pickup, a place, or the
 * flight number changed (ADR-0010). Spacing or case of the same designator
 * is still a stored flight-number change, and it leaves the Ride accepted
 * (ADR-0028). A note that becomes another note is a flight-number change.
 * Unassigned stays unassigned. Assigned stays assigned.
 */
export function correctionReturnsAcceptedRide(
  state: RideState,
  changed: readonly TransferCorrectionField[],
  flight: { readonly before: string | null, readonly after: string | null },
): boolean {
  if (state !== 'accepted')
    return false
  return changed.some((field) => {
    if (field === 'flightNumber')
      return !sameDesignatorSpelling(flight.before, flight.after)
    return (MATERIAL_TRANSFER_FIELDS as readonly string[]).includes(field)
  })
}

/** `OU 384` and `ou384` are one designator. A note is not. */
function sameDesignatorSpelling(before: string | null, after: string | null): boolean {
  return before !== null && after !== null && sameFlightDesignator(before, after)
}

function sameTransferField(field: TransferCorrectionField, before: CreateTransfer, after: CreateTransfer): boolean {
  if (field === 'pickupAt')
    return new Date(before.pickupAt).getTime() === new Date(after.pickupAt).getTime()
  return before[field] === after[field]
}

/**
 * Decline is allowed from `assigned` only (ADR-0006). The copied flag does
 * not matter: a Ride that must be accepted, and one that need not, can both
 * be declined while they are still `assigned`. `accepted` is refused.
 */
export function canDeclineRide(state: RideState): boolean {
  return state === 'assigned'
}

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
const clientReferenceSchema = optionalLine(CLIENT_REFERENCE_MAX_LENGTH)

/**
 * Missing, null, and whitespace become ''. A real sign is trimmed.
 * Unlike a flight or a note, empty text is the stored blank.
 */
const tablaSchema = z.union([z.null(), z.string()]).optional().transform(value => (value ?? '').trim()).pipe(z.string().max(TABLA_MAX_LENGTH))

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
  tabla: z.string().max(TABLA_MAX_LENGTH),
  clientReference: z.string().min(1).max(CLIENT_REFERENCE_MAX_LENGTH).nullable(),
})

export type Transfer = z.infer<typeof transferSchema>

/**
 * One Ride. `mustAccept` is null while unassigned: the copy is taken at
 * assignment and is not a live link to the Driver.
 */
export const rideSchema = z.object({
  id: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
})

export type Ride = z.infer<typeof rideSchema>

/**
 * The Ride after a landing time is recorded or cleared. The Ride columns are
 * unchanged. `landingAt` is the Transfer instant, or null when it was cleared.
 */
export const recordedLandingSchema = rideSchema.extend({
  landingAt: z.iso.datetime().nullable(),
})

export type RecordedLanding = z.infer<typeof recordedLandingSchema>

export const recordedTransferSchema = z.object({
  transfer: transferSchema,
  ride: rideSchema,
})

export type RecordedTransfer = z.infer<typeof recordedTransferSchema>

/**
 * POST /api/transfers. `alreadyRecorded` is true when this external id was
 * already stored and the body was not applied. A correction does not use it.
 */
export const recordedCreateSchema = recordedTransferSchema.extend({
  alreadyRecorded: z.boolean(),
})

export type RecordedCreate = z.infer<typeof recordedCreateSchema>

/** One row of the day list: the Ride and the Transfer it executes. */
export const transferDayRideSchema = transferSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
  // Empty until the aircraft has landed. Shown in the Tenant time zone.
  landingAt: z.iso.datetime().nullable(),
  // The live estimate. Shown in the Tenant time zone. Empty until the status reports one.
  expectedArrival: z.iso.datetime().nullable(),
  // Derived at read. Display only. A Ride with no landing stays false (ADR-0030).
  landingAlarm: z.boolean(),
  // Derived at read. Display only. Empty unless the Ride is assigned or accepted.
  warnings: boardWarningsSchema,
  // The Transfer version the form was opened with (ADR-0046). One version covers the Ride.
  version: z.number().int().nonnegative(),
  // Null until an office data save. A member who has left leaves the name null.
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
})

export type TransferDayRide = z.infer<typeof transferDayRideSchema>

/**
 * A decline the board shows for a Ride on this day. The name is joined from
 * the Driver id when the screen renders. The row stores no name.
 */
export const declineAlertSchema = z.object({
  id: z.uuid(),
  rideId: z.uuid(),
  driverId: z.uuid(),
  // Joined at read. The stored row keeps the Driver id only.
  driverName: z.string().min(1),
  guestName: z.string().min(1),
})

export type DeclineAlert = z.infer<typeof declineAlertSchema>

export const transferDaySchema = z.object({
  date: z.string().refine(isCalendarDate),
  rides: z.array(transferDayRideSchema),
  declineAlerts: z.array(declineAlertSchema),
})

export type TransferDay = z.infer<typeof transferDaySchema>

export type PickupAtError = 'invalid' | 'too-early' | 'too-late'

/**
 * The pickup instant is allowed when it is not earlier than 30 × 24 hours
 * before `now` and not later than 18 UTC calendar months after `now`. The
 * edges are included. Months are UTC calendar months; a day that does not
 * exist in the target month lands on the last day of that month. An
 * unparseable instant is `invalid`, not `too-early`.
 */
export function pickupAtError(pickupAt: string, now: Date): PickupAtError | null {
  const instant = new Date(pickupAt)
  if (Number.isNaN(instant.getTime()) || Number.isNaN(now.getTime()))
    return 'invalid'
  // 720 hours from `now`, not 30 Tenant-local calendar days.
  const earliest = now.getTime() - PICKUP_PAST_DAYS * 24 * 60 * 60 * 1000
  const latest = addUtcMonths(now, PICKUP_FUTURE_MONTHS).getTime()
  if (instant.getTime() < earliest)
    return 'too-early'
  if (instant.getTime() > latest)
    return 'too-late'
  return null
}

export type SameLocationError = 'same'

/** Start and end are two places. The same Location id is not a Transfer. */
export function sameLocationError(startLocationId: string, endLocationId: string): SameLocationError | null {
  return startLocationId === endLocationId ? 'same' : null
}

/**
 * The booking fields. A correction uses this shape alone, so `externalId`
 * is an unknown key there and is refused (ADR-0035).
 */
const transferBookingSchema = z.strictObject({
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
  tabla: tablaSchema,
  clientReference: clientReferenceSchema.optional(),
})

/**
 * POST /api/transfers. The airport mark is required, so a flight number
 * cannot stand in for it. An unknown key is refused. `externalId` is
 * required. A body without it is 400 and writes nothing. The server does
 * not assign one (ADR-0035). The pickup window and the same-place rule are
 * applied in {@link parseRecordTransfer}, which is the boundary the route
 * calls, so a refused body never opens a session.
 */
export const createTransferSchema = transferBookingSchema.extend({
  externalId: z.uuid(),
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
  readonly tabla: string
  readonly clientReference: string | null
}

/** The body was not a valid Transfer. Nothing is written. The guest name is not in the message. */
export class TransferInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'TransferInputError'
  }
}

type BookingBody = z.infer<typeof transferBookingSchema>

/**
 * Accepts a new Transfer. Any other body throws first, so the caller does not
 * open a session. `now` is the clock for the pickup window. The route leaves
 * it unset. Tests pass a fixed instant. `externalId` is required and dropped
 * here; {@link parseRecordTransfer} is what keeps it.
 */
export function parseCreateTransfer(raw: unknown, now: Date = new Date()): CreateTransfer {
  return parseRecordTransfer(raw, now).input
}

/**
 * The create body, split into the booking and the required entry key.
 * A missing `externalId` is the same 400 as any other bad body. The server
 * does not assign one. The id is not part of {@link CreateTransfer}.
 */
export function parseRecordTransfer(raw: unknown, now: Date = new Date()): { input: CreateTransfer, externalId: string } {
  const parsed = readBooking(createTransferSchema, raw, now)
  return {
    input: toCreateTransfer(parsed),
    externalId: parsed.externalId,
  }
}

function readBooking<T extends BookingBody>(schema: z.ZodType<T>, raw: unknown, now: Date): T {
  const parsed = schema.superRefine((value, ctx) => {
    if (pickupAtError(value.pickupAt, now)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pickupAt'],
        message: 'Pickup is outside the allowed window.',
      })
    }
    if (sameLocationError(value.startLocationId, value.endLocationId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endLocationId'],
        message: 'Start and end are the same place.',
      })
    }
  }).safeParse(raw)
  if (!parsed.success)
    throw new TransferInputError()
  return parsed.data
}

function toCreateTransfer(parsed: BookingBody): CreateTransfer {
  const cents = priceCents(parsed.price)
  if (cents === null)
    throw new TransferInputError()
  return {
    clientId: parsed.clientId,
    pickupAt: parsed.pickupAt,
    startLocationId: parsed.startLocationId,
    endLocationId: parsed.endLocationId,
    passengerCount: parsed.passengerCount,
    guestName: parsed.guestName,
    flightNumber: parsed.flightNumber === undefined ? null : parsed.flightNumber,
    price: formatPriceCents(cents),
    payment: parsed.payment,
    airportMark: parsed.airportMark,
    luggageCount: parsed.luggageCount,
    childSeatCount: parsed.childSeatCount,
    note: parsed.note === undefined ? null : parsed.note,
    tabla: parsed.tabla,
    clientReference: parsed.clientReference === undefined ? null : parsed.clientReference,
  }
}

/**
 * PATCH /api/transfers/:id. The booking is the record body, without the
 * ExternalRef. `confirm` is optional and only means the office has already
 * seen a true overlap. The record route does not accept it. `externalId`
 * is an unknown field and is 400: a correction cannot change the key.
 */
const correctionEnvelopeSchema = z.object({
  confirm: z.boolean().optional(),
  // The version the form was opened with. Missing is the same 400 as a bad booking.
  version: z.number().int().nonnegative(),
}).passthrough()

export function parseCorrectTransfer(raw: unknown, now: Date = new Date()): { input: CreateTransfer, confirm: boolean, version: number } {
  const envelope = correctionEnvelopeSchema.safeParse(raw)
  if (!envelope.success)
    throw new TransferInputError()
  const { confirm, version, ...booking } = envelope.data
  // The booking schema has no key. A body that sends one fails here.
  return { input: toCreateTransfer(readBooking(transferBookingSchema, booking, now)), confirm: confirm === true, version }
}

/**
 * GET /api/transfers `date`. Absent means the operational day that contains
 * now, in the Tenant time zone. Anything else that is not `YYYY-MM-DD` is
 * refused before a session opens.
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

/** A Client reference the form can refuse before a request. Blank is allowed. */
export function clientReferenceError(value: string): LineError | null {
  return value.trim().length > CLIENT_REFERENCE_MAX_LENGTH ? 'too-long' : null
}

export function noteError(value: string): LineError | null {
  return value.trim().length > NOTE_MAX_LENGTH ? 'too-long' : null
}

/** A meet sign the form can refuse before a request. Blank is allowed. */
export function tablaError(value: string): LineError | null {
  return value.trim().length > TABLA_MAX_LENGTH ? 'too-long' : null
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

/**
 * The same clock time, `months` UTC calendar months later. 31 January plus
 * one month is 28 or 29 February, not 2 or 3 March.
 */
function addUtcMonths(instant: Date, months: number): Date {
  const year = instant.getUTCFullYear()
  const monthIndex = instant.getUTCMonth()
  const day = instant.getUTCDate()
  const shifted = new Date(Date.UTC(
    year,
    monthIndex + months,
    1,
    instant.getUTCHours(),
    instant.getUTCMinutes(),
    instant.getUTCSeconds(),
    instant.getUTCMilliseconds(),
  ))
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate()
  shifted.setUTCDate(Math.min(day, lastDay))
  return shifted
}

function formatPriceCents(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const fraction = String(cents % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}
