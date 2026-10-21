import type { RideHistory, RideHistoryCursor } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { Buffer } from 'node:buffer'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { locationLabel, operationalDateInTimeZone, paymentMethodSchema, QueryParamError, RIDE_HISTORY_PAGE_SIZE, rideHistoryCountsSchema, rideHistorySchema, rideStateSchema, wallClockInTimeZone } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { ClientNotFoundError, loadClient } from '../../clients'
import { loadDrivers } from '../../drivers'
import { loadLocations } from '../../locations'
import { loadPartners } from '../../partners'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { toInstant, toPrice } from './transfers'

function officeOnly(role: string): void {
  // A Client's Rides are office work. A driver is refused before a Ride is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

const historyRowSchema = z.object({
  rideId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  partnerId: z.uuid().nullable(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  guestName: z.string().min(1),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
})

/**
 * The next page starts strictly before this row in newest-pickup order.
 * The token is not a secret. It names a pickup and a Ride id, nothing else.
 */
function encodeCursor(pickupAt: string, rideId: string): string {
  return Buffer.from(JSON.stringify({ pickupAt, rideId }), 'utf8').toString('base64url')
}

const rideHistoryQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
})

const rideHistoryCursorSchema = z.strictObject({
  pickupAt: z.iso.datetime(),
  rideId: z.uuid(),
})

/**
 * `cursor` is absent on the first page. A present cursor is the opaque
 * token from `nextCursor`. Anything else is 400, before a session opens.
 * An unknown query key is refused. The codec stays here, beside
 * {@link encodeCursor}, so `node:buffer` is not part of the screen bundle.
 */
function parseRideHistoryQuery(raw: unknown): RideHistoryCursor | null {
  const query = rideHistoryQuerySchema.safeParse(raw)
  if (!query.success)
    throw new QueryParamError()
  if (query.data.cursor === undefined)
    return null
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(query.data.cursor, 'base64url').toString('utf8'))
  }
  catch {
    throw new QueryParamError()
  }
  const cursor = rideHistoryCursorSchema.safeParse(decoded)
  if (!cursor.success)
    throw new QueryParamError()
  return cursor.data
}

/**
 * One Client's Rides, every state, newest pickup first. The page is
 * {@link RIDE_HISTORY_PAGE_SIZE} rows. Counts cover every Ride of this
 * Client, including rows the page does not return. v1 has no index on
 * `client_id` (ADR-0049). Names come from the catalog modules. The Partner
 * name is loaded through the Partners index, including an archived Partner,
 * because a handed-off Ride still shows that name (ADR-0048, ADR-0049).
 * A closed Ride no longer stores the Partner (#415), so that name is null.
 * A missing Client is the caller's 404. A database failure is logged as a SQLSTATE only.
 */
async function loadClientRideHistory(
  transaction: TenantTransaction,
  role: string,
  clientId: string,
  cursor: RideHistoryCursor | null,
): Promise<RideHistory> {
  officeOnly(role)
  await loadClient(transaction, clientId)
  const settings = await loadTenantSettings(transaction)
  const olderThan = cursor === null
    ? sql`true`
    : sql`(t.pickup_at < ${cursor.pickupAt} or (t.pickup_at = ${cursor.pickupAt} and r.id < ${cursor.rideId}))`
  const counted = z.object({ rows: z.array(rideHistoryCountsSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where r.state = 'done')::int as done,
        count(*) filter (where r.state = 'no-show')::int as "noShow",
        count(*) filter (where r.state = 'cancelled')::int as cancelled
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where t.client_id = ${clientId}
    `),
    'Ride history failed',
  ))
  const counts = counted.rows[0]
  if (counts === undefined)
    throw new Error('Ride history failed')
  const selected = z.object({ rows: z.array(historyRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        r.state,
        r.driver_id as "driverId",
        r.partner_id as "partnerId",
        t.pickup_at as "pickupAt",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        t.guest_name as "guestName",
        t.price,
        t.payment
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where t.client_id = ${clientId}
        and ${olderThan}
      order by t.pickup_at desc, r.id desc
      limit ${RIDE_HISTORY_PAGE_SIZE + 1}
    `),
    'Ride history failed',
  ))
  const places = new Map((await loadLocations(transaction, true)).map(place => [place.id, locationLabel(place)]))
  const drivers = new Map((await loadDrivers(transaction, true)).map(driver => [driver.id, driver.name]))
  // Archived Partners stay in the map. A Ride already handed to one still names it.
  const partners = new Map((await loadPartners(transaction, true)).map(partner => [partner.id, partner.name]))
  const page = selected.rows.slice(0, RIDE_HISTORY_PAGE_SIZE)
  const rides = page.map((row) => {
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    const driverName = row.driverId === null ? null : drivers.get(row.driverId)
    const partnerName = row.partnerId === null ? null : partners.get(row.partnerId)
    if (start === undefined || end === undefined || driverName === undefined || partnerName === undefined)
      throw new Error('Ride history failed')
    const pickupAt = toInstant(row.pickupAt)
    const pickup = new Date(pickupAt)
    return {
      rideId: row.rideId,
      operationalDay: operationalDateInTimeZone(settings.timeZone, pickup, settings.operationalDayStartHour),
      pickupAt,
      pickupWall: wallClockInTimeZone(settings.timeZone, pickup),
      guestName: row.guestName,
      start,
      end,
      state: row.state,
      driverName,
      partnerName,
      price: toPrice(row.price),
      payment: row.payment,
    }
  })
  const last = rides[rides.length - 1]
  const nextCursor = selected.rows.length > RIDE_HISTORY_PAGE_SIZE && last !== undefined
    ? encodeCursor(last.pickupAt, last.rideId)
    : null
  return rideHistorySchema.parse({ rides, nextCursor, counts })
}

/**
 * This Client's Ride history. The query is parsed first, so a bad cursor
 * never opens a session. A driver is 403. No session is 401. An unknown
 * Client, and another Tenant's Client, are 404. The read writes no audit.
 */
export async function listClientRideHistory(
  headers: Headers,
  clientId: string,
  rawQuery: unknown,
): Promise<RideHistory> {
  const cursor = parseRideHistoryQuery(rawQuery)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadClientRideHistory(transaction, actor.role, clientId, cursor)
    }
    catch (error) {
      if (error instanceof TenantAccessError || error instanceof ClientNotFoundError)
        throw error
      if (error instanceof Error && error.message === 'Ride history failed')
        throw error
      throw new Error('Ride history failed')
    }
  })
}
