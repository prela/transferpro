import { z } from 'zod'
import { isCalendarDate } from './date'
import { paymentMethodSchema, rideStateSchema, transferPriceSchema } from './transfer'

/**
 * One page of Ride history. ADR-0049. A longer page would make a
 * long-standing Client slow to open. The Partner read uses this same size.
 */
export const RIDE_HISTORY_PAGE_SIZE = 50

/** Pickup wall clock in the Tenant time zone: `YYYY-MM-DDTHH:mm`. */
const pickupWallSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

/**
 * One Ride on the Client card, or later on the Partner record.
 * `partnerName` stays null until a Ride can be handed to a Partner (#415).
 * `pickupAt` is the stored instant. `pickupWall` is that instant in the
 * Tenant time zone, which is what the row shows.
 */
export const rideHistoryRowSchema = z.object({
  rideId: z.uuid(),
  operationalDay: z.string().refine(isCalendarDate),
  pickupAt: z.iso.datetime(),
  pickupWall: pickupWallSchema,
  guestName: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  state: rideStateSchema,
  driverName: z.string().min(1).nullable(),
  partnerName: z.string().min(1).nullable(),
  price: transferPriceSchema,
  payment: paymentMethodSchema,
})

export type RideHistoryRow = z.infer<typeof rideHistoryRowSchema>

/**
 * Counts over the whole history, not the page. `noShow` is the No-show
 * state. Other states are only in `total`.
 */
export const rideHistoryCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  noShow: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
})

export type RideHistoryCounts = z.infer<typeof rideHistoryCountsSchema>

export const rideHistorySchema = z.object({
  rides: z.array(rideHistoryRowSchema),
  nextCursor: z.string().min(1).nullable(),
  counts: rideHistoryCountsSchema,
})

export type RideHistory = z.infer<typeof rideHistorySchema>

export interface RideHistoryCursor {
  readonly pickupAt: string
  readonly rideId: string
}
