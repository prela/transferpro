import { z } from 'zod'
import { isCalendarDate } from './date'
import { QueryParamError } from './query'
import { CLIENT_REFERENCE_MAX_LENGTH, FLIGHT_NUMBER_MAX_LENGTH, GUEST_NAME_MAX_LENGTH, rideStateSchema } from './transfer'

/**
 * The longest field the search can match. A guest name and a Client
 * reference are both 200; a flight number is shorter. A longer query
 * cannot match a stored value, so it is refused before a session opens.
 * The text is not logged and is not copied into the error.
 */
export const TRANSFER_SEARCH_MAX_LENGTH = Math.max(
  GUEST_NAME_MAX_LENGTH,
  CLIENT_REFERENCE_MAX_LENGTH,
  FLIGHT_NUMBER_MAX_LENGTH,
)

/**
 * How many rows the palette gets. The earliest pickups fill the list,
 * and a Ride id breaks a tie. There is no next page.
 */
export const TRANSFER_SEARCH_LIMIT = 20

const transferSearchQuerySchema = z.string().trim().min(1).max(TRANSFER_SEARCH_MAX_LENGTH)

/**
 * GET /api/transfers/search `q`. Blank and over-long text are refused
 * before a session opens. Surrounding spaces are not part of the match.
 * The value is the query text; it must not be written to a log or an audit entry.
 */
export function parseTransferSearchQuery(raw: unknown): string {
  const parsed = transferSearchQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new QueryParamError()
  return parsed.data
}

/**
 * One palette row. `start` and `end` are Location names, `clientName` is
 * the Client's name, and `operationalDay` is the board day the Ride opens
 * on. A pickup before the Tenant's start hour belongs to the previous day.
 */
export const transferSearchHitSchema = z.object({
  rideId: z.uuid(),
  operationalDay: z.string().refine(isCalendarDate),
  pickupAt: z.iso.datetime(),
  guestName: z.string().trim().min(1).max(GUEST_NAME_MAX_LENGTH),
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  clientName: z.string().trim().min(1),
  state: rideStateSchema,
})

export type TransferSearchHit = z.infer<typeof transferSearchHitSchema>

export const transferSearchSchema = z.object({
  results: z.array(transferSearchHitSchema).max(TRANSFER_SEARCH_LIMIT),
})

export type TransferSearch = z.infer<typeof transferSearchSchema>
