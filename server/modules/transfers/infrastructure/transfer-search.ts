import type { TransferSearch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { localDayBounds, operationalDateInTimeZone, parseTransferSearchQuery, rideStateSchema, TRANSFER_SEARCH_LIMIT, transferSearchSchema } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'
import { loadClients } from '../../clients'
import { loadLocations } from '../../locations'
import { loadTenantSettings, TenantAccessError, withTenantFromSession } from '../../tenancy'
import { toInstant } from './transfers'

function officeOnly(role: string): void {
  // Finding a Transfer on another day is office work. A driver is refused
  // before a Ride is read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

const searchRowSchema = z.object({
  rideId: z.uuid(),
  state: rideStateSchema,
  clientId: z.uuid(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  guestName: z.string(),
})

/**
 * `%`, `_`, and `\` are literal characters in the query. Without the escape,
 * a search for `%` would match every Transfer.
 */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, match => `\\${match}`)}%`
}

/**
 * Transfers whose guest, Client reference, or flight number contains the
 * query, on any pickup day. The match is a case-insensitive substring.
 * A tabla and a Client name are not fields. Today and later come first,
 * earliest pickup first. Past operational days follow, newest first.
 * `now` names that operational day. Names are resolved through the catalog
 * modules on this transaction (ADR-0018). Nothing is written.
 * A database failure is logged as a SQLSTATE only, so the query text in
 * Drizzle's error message never reaches the log.
 */
async function loadTransferSearch(transaction: TenantTransaction, query: string, now: Date): Promise<TransferSearch> {
  const settings = await loadTenantSettings(transaction)
  const pattern = likePattern(query)
  const today = operationalDateInTimeZone(settings.timeZone, now, settings.operationalDayStartHour)
  // A pickup at or after this instant is today or a later operational day.
  const cutoff = localDayBounds(today, settings.timeZone, settings.operationalDayStartHour).start.toISOString()
  const selected = z.object({ rows: z.array(searchRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        r.state,
        t.client_id as "clientId",
        t.pickup_at as "pickupAt",
        t.start_location_id as "startLocationId",
        t.end_location_id as "endLocationId",
        t.guest_name as "guestName"
      from app.rides as r
      join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where t.guest_name ilike ${pattern} escape '\\'
         or t.client_reference ilike ${pattern} escape '\\'
         or t.flight_number ilike ${pattern} escape '\\'
      order by (t.pickup_at >= ${cutoff}) desc,
               case when t.pickup_at >= ${cutoff} then t.pickup_at end asc,
               case when t.pickup_at >= ${cutoff} then r.id end asc,
               case when t.pickup_at < ${cutoff} then t.pickup_at end desc,
               case when t.pickup_at < ${cutoff} then r.id end desc
      limit ${TRANSFER_SEARCH_LIMIT}
    `),
    'Transfer search failed',
  ))

  const clients = new Map((await loadClients(transaction)).map(client => [client.id, client.name]))
  const places = new Map((await loadLocations(transaction, true)).map(place => [place.id, place.name]))
  const results = selected.rows.map((row) => {
    const start = places.get(row.startLocationId)
    const end = places.get(row.endLocationId)
    const clientName = clients.get(row.clientId)
    if (start === undefined || end === undefined || clientName === undefined)
      throw new Error('Transfer search failed')
    const pickupAt = toInstant(row.pickupAt)
    return {
      rideId: row.rideId,
      operationalDay: operationalDateInTimeZone(
        settings.timeZone,
        new Date(pickupAt),
        settings.operationalDayStartHour,
      ),
      pickupAt,
      guestName: row.guestName,
      start,
      end,
      clientName,
      state: row.state,
    }
  })
  return transferSearchSchema.parse({ results })
}

/**
 * Search this Tenant's Transfers across days. The query is parsed first, so
 * a blank or over-long value never opens a session and is not logged.
 * Today and later are listed first, earliest pickup first. Past operational
 * days follow, newest first. At most 20 rows. `now` is the clock; the route
 * leaves it unset. A driver is 403. No session is 401. Another Tenant
 * cannot: the tables have FORCE RLS. The read writes no audit entry.
 */
export async function searchTransfers(headers: Headers, rawQuery: unknown, now: Date = new Date()): Promise<TransferSearch> {
  const query = parseTransferSearchQuery(rawQuery)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadTransferSearch(transaction, query, now)
    }
    catch (error) {
      if (error instanceof TenantAccessError)
        throw error
      if (error instanceof Error && error.message === 'Transfer search failed')
        throw error
      throw new Error('Transfer search failed')
    }
  })
}
