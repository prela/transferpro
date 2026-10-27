import { z } from 'zod'
import { boardWarningsSchema } from './board-warnings'
import { clientOfficeBriefSchema } from './client-office-brief'
import { isCalendarDate } from './date'
import { sameFlightDesignator } from './flight-landing'
import { partnerOfficeContactSchema } from './partner'
import { QueryParamError } from './query'

/**
 * A price is EUR, stored as numeric(10, 2). Zero is a free ride. A day of
 * digits is too long for a fare and is refused. The currency is not a column.
 */
export const TRANSFER_PRICE_MAX = 99_999_999.99

/** One vehicle. Sixty is a coach, not a pasted spreadsheet. */
export const PASSENGER_COUNT_MIN = 1
export const PASSENGER_COUNT_MAX = 60

/**
 * The group's ordered passenger count. One more than a coach, and not a
 * pasted spreadsheet: a thousand is the group maximum the G1 spec names.
 * Empty on the row means the Transfer's own passenger count (ADR-0054).
 */
export const GROUP_PASSENGER_COUNT_MIN = 1
export const GROUP_PASSENGER_COUNT_MAX = 1000

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
 * ADR-0005, extended by ADR-0048. Creating a Transfer writes `unassigned`.
 * Assignment writes `assigned`. Acceptance writes `accepted`. A handoff
 * writes `handed_off`. Done writes `done`. `no-show` and `cancelled` are
 * terminal, and so is `done`.
 */
export const RIDE_STATES = ['unassigned', 'assigned', 'accepted', 'handed_off', 'done', 'no-show', 'cancelled'] as const

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
 * ADR-0005, extended by ADR-0048. A dispatcher or an admin may cancel from
 * these states. The copied flag does not matter. `done`, `no-show`, and a
 * second cancel are terminal and are refused. SQL that locks or writes a
 * cancel uses this same list, so a new cancellable state is one edit.
 */
export const CANCELLABLE_RIDE_STATES = ['unassigned', 'assigned', 'accepted', 'handed_off'] as const satisfies readonly RideState[]

export function canCancelRide(state: RideState): boolean {
  // The tuple is a subset of RideState. `includes` needs the wider array type.
  return (CANCELLABLE_RIDE_STATES as readonly RideState[]).includes(state)
}

/**
 * ADR-0007 and ADR-0028. A landing time can be recorded or cleared while the
 * Ride is unfinished, including before anyone is assigned. `handed_off` is
 * not included: landing time stays on a Ride the office still runs.
 * `done`, `no-show`, and `cancelled` keep the time they already have.
 * The Ride state is not a landing-time change.
 */
export function canRecordLandingTime(state: RideState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted'
}

/**
 * ADR-0010, extended by ADR-0048. A dispatcher or an admin may correct the
 * booking while the Ride is unfinished, including when it is handed to a
 * Partner. `done`, `no-show`, and `cancelled` keep the details they have.
 */
export function canCorrectTransfer(state: RideState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'accepted' || state === 'handed_off'
}

/**
 * An extra vehicle is added from a main Transfer, or from an extra vehicle
 * on behalf of its main Transfer, while that main Ride is still correctable
 * (ADR-0054). The extra vehicle's own state does not decide. A missing main
 * is not offered.
 */
export function canAddExtraVehicle(ride: {
  readonly state: RideState
  readonly mainTransferId: string | null
  readonly linkedMain: { readonly state: RideState } | null
}): boolean {
  const state = ride.mainTransferId === null ? ride.state : ride.linkedMain?.state
  return state !== undefined && canCorrectTransfer(state)
}

/**
 * Field names a correction may store. The Client and the two Locations are
 * ids on the row as well, and a change of either is still a field name.
 * A guest name, a flight number, a note, a tabla, a Client reference, or a
 * price is not a name in this list: those values stay on the Transfer.
 * `groupPassengerCount` is the group's ordered count on the main Transfer.
 * The number itself is not stored on the audit row (ADR-0054).
 */
export const TRANSFER_CORRECTION_FIELDS = [
  'clientId',
  'pickupAt',
  'startLocationId',
  'endLocationId',
  ...TRANSFER_FIELDS.filter(field => field !== 'pickupAt'),
  'groupPassengerCount',
] as const

export const transferCorrectionFieldSchema = z.enum(TRANSFER_CORRECTION_FIELDS)

export type TransferCorrectionField = z.infer<typeof transferCorrectionFieldSchema>

/**
 * Pickup, the two places, and the flight number.
 * An accepted Ride returns to assigned only when one of these changes,
 * apart from a flight whose designator spelling is unchanged (ADR-0010).
 * A main-Transfer correction that changes one of these, and is not applied
 * to the group, tells the office how many unfinished extra vehicles it has.
 * Copying those fields onto extra vehicles uses this same list (ADR-0054).
 */
export const ROUTE_TRANSFER_FIELDS = ['pickupAt', 'startLocationId', 'endLocationId', 'flightNumber'] as const

/**
 * A correction changes the route when the pickup, a place, or the flight
 * number is among the changed fields. Spacing of the same designator is
 * still a route change: the stored flight number changed. Whether an
 * accepted Ride returns to assigned is {@link correctionReturnsAcceptedRide}.
 */
export function correctionChangesRoute(changed: readonly string[]): boolean {
  return changed.some(field => (ROUTE_TRANSFER_FIELDS as readonly string[]).includes(field))
}

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
    return (ROUTE_TRANSFER_FIELDS as readonly string[]).includes(field)
  })
}

/** `OU 384` and `ou384` are one designator. A note is not. */
function sameDesignatorSpelling(before: string | null, after: string | null): boolean {
  return before !== null && after !== null && sameFlightDesignator(before, after)
}

function sameTransferField(field: TransferCorrectionField, before: CreateTransfer, after: CreateTransfer): boolean {
  if (field === 'pickupAt')
    return new Date(before.pickupAt).getTime() === new Date(after.pickupAt).getTime()
  // The group count is not a booking field. The correction compares it
  // beside this list, so a booking-only diff does not report it.
  if (field === 'groupPassengerCount')
    return true
  return before[field] === after[field]
}

/**
 * The group count an office Transfer read returns. An extra vehicle has
 * none of its own: the count lives on the main Transfer. A main Transfer
 * with an empty column uses its own passenger count (ADR-0054).
 */
export function officeGroupPassengerCount(
  mainTransferId: string | null,
  stored: number | null,
  passengerCount: number,
): number | null {
  if (mainTransferId !== null)
    return null
  return stored ?? passengerCount
}

/** `main` carries the group's price. `extra` is a linked vehicle and hides it. */
export type TransferGroupRole = 'main' | 'extra'

/**
 * The work order and the Driver card mark a group from the stored columns.
 * An empty ordered count is not a group: the office read fills that empty
 * with the vehicle's own count, and that fill would mark every Transfer.
 * A link is an extra vehicle even though its ordered count is empty (ADR-0054).
 */
export function transferGroupRole(
  mainTransferId: string | null,
  storedGroupPassengerCount: number | null,
): TransferGroupRole | null {
  if (mainTransferId !== null)
    return 'extra'
  if (storedGroupPassengerCount !== null)
    return 'main'
  return null
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
  // Null when this Transfer is not an extra vehicle. The group's count is
  // then on this row. An extra vehicle names its main Transfer and carries
  // no group count of its own (ADR-0054).
  mainTransferId: z.uuid().nullable(),
  groupPassengerCount: z.number().int().min(GROUP_PASSENGER_COUNT_MIN).max(GROUP_PASSENGER_COUNT_MAX).nullable(),
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
  // True when the new Transfer's window has no free Driver with a free
  // Vehicle and no free Partner. The save still stands (ADR-0034).
  fullyBooked: z.boolean(),
})

export type RecordedCreate = z.infer<typeof recordedCreateSchema>

/**
 * The main Transfer an extra-vehicle row copies. Null on a main Transfer.
 * The day read joins it even when that pickup is another day, so the form
 * starts from the main Transfer (ADR-0054).
 */
export const linkedMainSchema = z.object({
  transferId: z.uuid(),
  state: rideStateSchema,
  version: z.number().int().nonnegative(),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  // False while the column is empty. The form asks only then.
  groupPassengerCountStored: z.boolean(),
  clientId: z.uuid(),
  pickupAt: z.iso.datetime(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  guestName: z.string().min(1),
  flightNumber: z.string().nullable(),
  payment: paymentMethodSchema,
  airportMark: z.boolean(),
  tabla: z.string(),
  clientReference: z.string().nullable(),
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
})

export type LinkedMain = z.infer<typeof linkedMainSchema>

/** One row of the day list: the Ride and the Transfer it executes. */
export const transferDayRideSchema = transferSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
  // Set while the Ride is handed off. Null on every other state, and after
  // a take-back or a close. The screen names the Partner from the catalog.
  // The board warning is derived from this id (ADR-0048).
  partnerId: z.uuid().nullable(),
  // Empty until the aircraft has landed. Shown in the Tenant time zone.
  landingAt: z.iso.datetime().nullable(),
  // The live estimate. Shown in the Tenant time zone. Empty until the status reports one.
  expectedArrival: z.iso.datetime().nullable(),
  // Derived at read, by the same rule as office home. Display only.
  // On 60 minutes after the occupied end for an in-progress Ride and a
  // handed-off Ride (ADR-0055).
  unclosedMark: z.boolean(),
  // Derived at read. Display only. Empty unless the Ride is assigned or accepted.
  warnings: boardWarningsSchema,
  // How many unfinished extra vehicles this main Transfer still has, on
  // any day. Zero on an extra vehicle and when the group has none left.
  // The cancel dialog reads it. Nothing is sent until the office confirms
  // (ADR-0054).
  unfinishedExtraVehicleCount: z.number().int().nonnegative(),
  // True when the column is stored. The office count above still substitutes
  // this Transfer's own passenger count while the column is empty, so the
  // form cannot tell those apart from the number alone.
  groupPassengerCountStored: z.boolean(),
  // The main Transfer, when this row is an extra vehicle. Null on a main Transfer.
  linkedMain: linkedMainSchema.nullable(),
  // The Transfer version the form was opened with (ADR-0046). One version covers the Ride.
  version: z.number().int().nonnegative(),
  // Null until an office data save. A member who has left leaves the name null.
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
})

export type TransferDayRide = z.infer<typeof transferDayRideSchema>

/**
 * One member of a group. A subset of the day row, so a later day-row field
 * is not invented here. The pickup is this member's own Transfer, never a
 * pickup copied from the main Transfer (ADR-0054).
 */
export const transferGroupMemberSchema = transferDayRideSchema.pick({
  rideId: true,
  transferId: true,
  guestName: true,
  pickupAt: true,
  startLocationId: true,
  endLocationId: true,
  state: true,
  driverId: true,
  partnerId: true,
  mainTransferId: true,
  groupPassengerCount: true,
})

export type TransferGroupMember = z.infer<typeof transferGroupMemberSchema>

/** The whole group. `members` is empty when this Transfer is not in one. */
export const transferGroupSchema = z.object({
  members: z.array(transferGroupMemberSchema),
})

export type TransferGroup = z.infer<typeof transferGroupSchema>

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
  /**
   * Every Client of this Tenant, not only those with a Ride today. The
   * Transfer form shows the note as soon as a Client is chosen, including
   * one that has no Ride on this day. A removed contact person is absent.
   * The Driver's read does not carry this list. ADR-0049.
   */
  clientBriefs: z.array(clientOfficeBriefSchema),
  /**
   * Phone and email of each Partner a Ride on this day is handed to.
   * An archived Partner stays here while the Ride still names it.
   * A day with no handed-off Ride is an empty list. The note is not here.
   * The Driver's read does not carry this list. ADR-0049.
   */
  partnerBriefs: z.array(partnerOfficeContactSchema),
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
  // The group's ordered count. A correction of the main Transfer may send
  // it. Absent leaves the stored count. Null is not a clear (ADR-0054).
  groupPassengerCount: z.number().int().min(GROUP_PASSENGER_COUNT_MIN).max(GROUP_PASSENGER_COUNT_MAX).optional(),
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
  // The main Transfer this extra vehicle belongs to. Absent on an ordinary create.
  mainTransferId: z.uuid().optional(),
  // The main Transfer's opened version, required only when this create stores
  // the group count. The route checks that after it locks the main row.
  mainVersion: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  const linked = value.mainTransferId !== undefined
  // A group count and the main version belong to an extra-vehicle create.
  // An ordinary Transfer does not store either.
  if (!linked && (value.groupPassengerCount !== undefined || value.mainVersion !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['mainTransferId'],
      message: 'A group count belongs on an extra vehicle.',
    })
  }
  // The Price of an extra vehicle is 0. Any other Price is refused before a session.
  if (linked && value.price !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['price'],
      message: 'An extra vehicle has no price.',
    })
  }
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
export interface RecordTransferRequest {
  readonly input: CreateTransfer
  readonly externalId: string
  /** Set when this create is an extra vehicle. Null on an ordinary Transfer. */
  readonly mainTransferId: string | null
  /** The group count to store on the main Transfer, or null when the body omits it. */
  readonly groupPassengerCount: number | null
  /** The main Transfer's opened version, or null when the body omits it. */
  readonly mainVersion: number | null
}

export function parseRecordTransfer(raw: unknown, now: Date = new Date()): RecordTransferRequest {
  const parsed = readBooking(createTransferSchema, raw, now)
  return {
    input: toCreateTransfer(parsed),
    externalId: parsed.externalId,
    mainTransferId: parsed.mainTransferId ?? null,
    groupPassengerCount: parsed.groupPassengerCount ?? null,
    mainVersion: parsed.mainVersion ?? null,
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

export function parseCorrectTransfer(raw: unknown, now: Date = new Date()): { input: CreateTransfer, confirm: boolean, version: number, groupPassengerCount: number | null } {
  const envelope = correctionEnvelopeSchema.safeParse(raw)
  if (!envelope.success)
    throw new TransferInputError()
  const { confirm, version, ...booking } = envelope.data
  // The booking schema has no key. A body that sends one fails here.
  // A link is not a correction field. The group count is, and null means
  // the body left it out: a correction does not clear it.
  const parsed = readBooking(transferBookingSchema, booking, now)
  return {
    input: toCreateTransfer(parsed),
    confirm: confirm === true,
    version,
    groupPassengerCount: parsed.groupPassengerCount ?? null,
  }
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

/** The group's ordered count. One vehicle's maximum is not the group's. */
export function groupPassengerCountError(value: string): CountError | null {
  return countError(value, GROUP_PASSENGER_COUNT_MIN, GROUP_PASSENGER_COUNT_MAX)
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
