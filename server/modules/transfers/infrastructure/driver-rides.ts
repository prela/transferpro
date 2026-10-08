import type { PaymentMethod } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { paymentMethodSchema, transferPriceSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'

/**
 * A Ride the linked Driver may see, before place names and the cash rule.
 * The place ids stay here so Locations are read through that module, by id.
 */
export interface UpcomingRideRow {
  readonly rideId: string
  readonly pickupAt: string
  readonly guestName: string
  readonly startLocationId: string
  readonly endLocationId: string
  readonly passengerCount: number
  readonly flightNumber: string | null
  readonly airportMark: boolean
  readonly price: string
  readonly payment: PaymentMethod
  readonly state: 'assigned' | 'accepted'
  readonly mustAccept: boolean
}

const upcomingRowSchema = z.object({
  rideId: z.uuid(),
  pickupAt: z.unknown(),
  guestName: z.string(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int(),
  flightNumber: z.string().nullable(),
  airportMark: z.boolean(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
  state: z.enum(['assigned', 'accepted']),
  mustAccept: z.boolean(),
})

/**
 * Upcoming Rides for one Driver: `assigned` or `accepted`, soonest pickup
 * first. There is no horizon. A past Ride that is still assigned stays on
 * the phone, and so does one far ahead. Each row carries `state` and the
 * must-accept copy. RLS is tenant-only, so this `where` is what hides
 * another Driver. The caller passes the Driver linked to the session, never
 * an id from the request.
 */
const upcomingRows = z.object({ rows: z.array(upcomingRowSchema) })

export async function loadUpcomingRidesForDriver(
  transaction: TenantTransaction,
  driverId: string,
): Promise<UpcomingRideRow[]> {
  const selected = upcomingRows.parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.pickup_at as "pickupAt",
        t.guest_name as "guestName",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        t.passenger_count as "passengerCount",
        t.flight_number as "flightNumber",
        t.airport_mark as "airportMark",
        t.price,
        t.payment,
        r.state,
        r.must_accept as "mustAccept"
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where r.driver_id = ${driverId}
        and r.state in ('assigned', 'accepted')
      order by t.pickup_at, r.id
    `),
    'Driver ride read failed',
  ))
  return selected.rows.map(toUpcomingRide)
}

function toUpcomingRide(row: z.infer<typeof upcomingRowSchema>): UpcomingRideRow {
  return {
    rideId: row.rideId,
    pickupAt: toInstant(row.pickupAt),
    guestName: row.guestName,
    startLocationId: row.startLocationId,
    endLocationId: row.endLocationId,
    passengerCount: row.passengerCount,
    flightNumber: row.flightNumber,
    airportMark: row.airportMark,
    price: toPrice(row.price),
    payment: row.payment,
    state: row.state,
    mustAccept: row.mustAccept,
  }
}

/** node-pg may return a Date or a timestamp string. The API always uses ISO-8601 UTC. */
function toInstant(value: unknown): string {
  if (value instanceof Date)
    return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('Driver ride read failed')
    return parsed.toISOString()
  }
  throw new Error('Driver ride read failed')
}

/** numeric comes back as text. The API always uses two decimal places. */
function toPrice(value: string | number): string {
  const parsed = transferPriceSchema.safeParse(typeof value === 'number' ? value.toFixed(2) : normalizePriceText(value))
  if (!parsed.success)
    throw new Error('Driver ride read failed')
  return parsed.data
}

function normalizePriceText(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    return value
  const cents = Math.round(Number(value) * 100)
  const whole = Math.trunc(cents / 100)
  const fraction = String(cents % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}
