import type { PaymentMethod } from './transfer'
import { z } from 'zod'
import { clientKindSchema, clientNameSchema } from './client'
import { LOCATION_ADDRESS_MAX_LENGTH } from './location'
import { CHILD_SEAT_COUNT_MAX, CHILD_SEAT_COUNT_MIN, GUEST_NAME_MAX_LENGTH, LUGGAGE_COUNT_MAX, LUGGAGE_COUNT_MIN, NOTE_MAX_LENGTH, PASSENGER_COUNT_MAX, PASSENGER_COUNT_MIN, TABLA_MAX_LENGTH, transferPriceSchema } from './transfer'
import { VEHICLE_PLATE_MAX_LENGTH } from './vehicle'

/**
 * One Ride on the Driver's phone. The price and the method are present only
 * for cash. Card and invoice to agency carry neither (ADR-0009, ADR-0020).
 * A null pair is how the payload says "not cash" without naming the method.
 * The Client, both addresses, the counts, the note, the tabla, and the plate
 * stay on a card Ride and on an invoice Ride. An empty address, note, or
 * tabla is null. A count of zero stays a number.
 * `state` is only `assigned` or `accepted`: finished Rides are not on this
 * list. `mustAccept` is the copy taken at assignment. An accepted Ride
 * always requires acceptance, the same pair the table check stores.
 */
export const driverUpcomingRideSchema = z.object({
  rideId: z.uuid(),
  pickupAt: z.iso.datetime(),
  guestName: z.string().trim().min(1).max(GUEST_NAME_MAX_LENGTH),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  passengerCount: z.number().int().min(PASSENGER_COUNT_MIN).max(PASSENGER_COUNT_MAX),
  flightNumber: z.string().trim().min(1).nullable(),
  airportMark: z.boolean(),
  clientName: clientNameSchema,
  clientKind: clientKindSchema,
  fromAddress: z.string().trim().min(1).max(LOCATION_ADDRESS_MAX_LENGTH).nullable(),
  toAddress: z.string().trim().min(1).max(LOCATION_ADDRESS_MAX_LENGTH).nullable(),
  luggageCount: z.number().int().min(LUGGAGE_COUNT_MIN).max(LUGGAGE_COUNT_MAX),
  childSeatCount: z.number().int().min(CHILD_SEAT_COUNT_MIN).max(CHILD_SEAT_COUNT_MAX),
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).nullable(),
  tabla: z.string().trim().min(1).max(TABLA_MAX_LENGTH).nullable(),
  registrationPlate: z.string().trim().min(1).max(VEHICLE_PLATE_MAX_LENGTH),
  price: transferPriceSchema.nullable(),
  payment: z.literal('cash').nullable(),
  state: z.enum(['assigned', 'accepted']),
  mustAccept: z.boolean(),
}).superRefine((row, ctx) => {
  const showsFare = row.payment === 'cash'
  if (showsFare !== (row.price !== null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'A cash Ride has a price. Any other Ride has neither.',
    })
  }
  if (row.state === 'accepted' && !row.mustAccept) {
    ctx.addIssue({
      code: 'custom',
      message: 'An accepted Ride requires acceptance.',
    })
  }
})

export type DriverUpcomingRide = z.infer<typeof driverUpcomingRideSchema>

export const driverUpcomingListSchema = z.object({
  rides: z.array(driverUpcomingRideSchema),
})

export type DriverUpcomingList = z.infer<typeof driverUpcomingListSchema>

/**
 * The row the query read, before the phone rule. `payment` is the Transfer's
 * method. The phone never receives it unless it is cash.
 */
export interface DriverRideSource {
  readonly rideId: string
  readonly pickupAt: string
  readonly guestName: string
  readonly from: string
  readonly to: string
  readonly passengerCount: number
  readonly flightNumber: string | null
  readonly airportMark: boolean
  readonly clientName: string
  readonly clientKind: 'agency' | 'hotel' | 'individual'
  readonly fromAddress: string | null
  readonly toAddress: string | null
  readonly luggageCount: number
  readonly childSeatCount: number
  /** Stored note. Empty is null on the phone. The text is not rewritten. */
  readonly note: string | null
  /** Stored meet-sign text, including ''. Empty becomes null on the phone. */
  readonly tabla: string
  readonly registrationPlate: string
  readonly price: string
  readonly payment: PaymentMethod
  readonly state: 'assigned' | 'accepted'
  readonly mustAccept: boolean
}

/**
 * Cash keeps the price and the word cash. Card and invoice to agency drop
 * both, so a card fare cannot be read off the response.
 */
/**
 * A blank line is absent. The stored tabla is '' when the Transfer has no
 * meet sign, and a note or an address is already null. The phone uses null
 * for all three so an empty row is not a value.
 */
function absentLine(value: string | null): string | null {
  if (value === null)
    return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function presentDriverRide(source: DriverRideSource): DriverUpcomingRide {
  const cash = source.payment === 'cash'
  return driverUpcomingRideSchema.parse({
    rideId: source.rideId,
    pickupAt: source.pickupAt,
    guestName: source.guestName,
    from: source.from,
    to: source.to,
    passengerCount: source.passengerCount,
    flightNumber: source.flightNumber,
    airportMark: source.airportMark,
    clientName: source.clientName,
    clientKind: source.clientKind,
    fromAddress: absentLine(source.fromAddress),
    toAddress: absentLine(source.toAddress),
    luggageCount: source.luggageCount,
    childSeatCount: source.childSeatCount,
    note: absentLine(source.note),
    tabla: absentLine(source.tabla),
    registrationPlate: source.registrationPlate,
    price: cash ? source.price : null,
    payment: cash ? 'cash' : null,
    state: source.state,
    mustAccept: source.mustAccept,
  })
}
