import type { PaymentMethod } from './transfer'
import { z } from 'zod'
import { GUEST_NAME_MAX_LENGTH, PASSENGER_COUNT_MAX, PASSENGER_COUNT_MIN, transferPriceSchema } from './transfer'

/**
 * One Ride on the Driver's phone. The price and the method are present only
 * for cash. Card and invoice to agency carry neither (ADR-0009, ADR-0020).
 * A null pair is how the payload says "not cash" without naming the method.
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
  readonly price: string
  readonly payment: PaymentMethod
  readonly state: 'assigned' | 'accepted'
  readonly mustAccept: boolean
}

/**
 * Cash keeps the price and the word cash. Card and invoice to agency drop
 * both, so a card fare cannot be read off the response.
 */
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
    price: cash ? source.price : null,
    payment: cash ? 'cash' : null,
    state: source.state,
    mustAccept: source.mustAccept,
  })
}
