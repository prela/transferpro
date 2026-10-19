import type { SQL } from 'drizzle-orm'
import type { UnavailabilityResource } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { UnavailabilityQuery, UnavailabilityReader, UnavailabilityRecord, UnavailabilityStore, UnavailabilityWindow, WindowTimes } from '../application/ports'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hideDatabaseError } from '../../../core/index'

/*
 * The window table on the caller's tenant transaction. Row level security
 * keeps every read and write inside the session's Tenant. Only the
 * retention job deletes; nothing here does.
 */

const windowRows = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    driverId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    startsAt: z.unknown(),
    endsAt: z.unknown(),
  })),
})

const deletedRows = z.object({ rowCount: z.number().int().nonnegative() })

const columns = sql`id, driver_id as "driverId", vehicle_id as "vehicleId", starts_at as "startsAt", ends_at as "endsAt"`

function toInstant(value: unknown): Date {
  const instant = value instanceof Date ? value : new Date(z.string().parse(value))
  if (Number.isNaN(instant.getTime()))
    throw new Error('Unavailability window instant is not a timestamp.')
  return instant
}

function instant(value: Date): SQL {
  return sql`cast(${value.toISOString()} as timestamptz)`
}

async function select(transaction: TenantTransaction, query: SQL, failure: string): Promise<UnavailabilityWindow[]> {
  const parsed = windowRows.parse(await hideDatabaseError(() => transaction.execute(query), failure))
  return parsed.rows.map(row => ({
    id: row.id,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    startsAt: toInstant(row.startsAt),
    endsAt: toInstant(row.endsAt),
  }))
}

function single(windows: readonly UnavailabilityWindow[]): UnavailabilityWindow {
  const [window] = windows
  if (!window)
    throw new Error('Unavailability window write returned no row.')
  return window
}

/** Half-open overlap with `[from, to)`. */
function during(from: Date, to: Date): SQL {
  return sql`starts_at < ${instant(to)} and ends_at > ${instant(from)}`
}

function ownedBy(resource: UnavailabilityResource): SQL {
  return resource.kind === 'driver' ? sql`driver_id = ${resource.id}` : sql`vehicle_id = ${resource.id}`
}

function idList(ids: readonly string[]): SQL {
  return sql.join([...new Set(ids)].map(id => sql`${id}`), sql`, `)
}

/**
 * The live windows of these Drivers and Vehicles over `[from, to)`. A read
 * without row locks: a capacity write holds the Tenant lock, so every
 * other window write has committed or not started.
 */
export function unavailabilityReader(transaction: TenantTransaction): UnavailabilityReader {
  return async (query: UnavailabilityQuery) => {
    const owners = [
      ...(query.driverIds.length > 0 ? [sql`driver_id in (${idList(query.driverIds)})`] : []),
      ...(query.vehicleIds.length > 0 ? [sql`vehicle_id in (${idList(query.vehicleIds)})`] : []),
    ]
    if (owners.length === 0 || query.to.getTime() <= query.from.getTime())
      return []
    return select(transaction, sql`
      select ${columns}
      from app.unavailability_windows
      where not removed
        and (${sql.join(owners, sql` or `)})
        and ${during(query.from, query.to)}
      order by starts_at, id
    `, 'Unavailability read failed')
  }
}

export function unavailabilityStore(transaction: TenantTransaction): UnavailabilityStore {
  return {
    insert: async (record: UnavailabilityRecord) => single(await select(transaction, sql`
      insert into app.unavailability_windows (driver_id, vehicle_id, starts_at, ends_at)
      values (${record.driverId}, ${record.vehicleId}, ${instant(record.startsAt)}, ${instant(record.endsAt)})
      returning ${columns}
    `, 'Unavailability write failed')),

    lockLive: async (windowId: string) => (await select(transaction, sql`
      select ${columns}
      from app.unavailability_windows
      where id = ${windowId} and not removed
      for update
    `, 'Unavailability read failed'))[0] ?? null,

    update: async (windowId: string, times: WindowTimes) => single(await select(transaction, sql`
      update app.unavailability_windows
      set starts_at = ${instant(times.startsAt)}, ends_at = ${instant(times.endsAt)}
      where id = ${windowId}
      returning ${columns}
    `, 'Unavailability write failed')),

    markRemoved: async (windowId: string) => {
      await hideDatabaseError(() => transaction.execute(sql`
        update app.unavailability_windows set removed = true where id = ${windowId}
      `), 'Unavailability write failed')
    },

    liveOf: async (resource: UnavailabilityResource) => select(transaction, sql`
      select ${columns}
      from app.unavailability_windows
      where not removed and ${ownedBy(resource)}
      order by starts_at, id
    `, 'Unavailability read failed'),

    liveDuring: async (from: Date, to: Date) => select(transaction, sql`
      select ${columns}
      from app.unavailability_windows
      where not removed and ${during(from, to)}
      order by starts_at, id
    `, 'Unavailability read failed'),
  }
}

/**
 * Delete this Tenant's windows that ended before `before`, removed or not
 * (ADR-0034). The restrictive policy refuses any newer one even if asked.
 * Answers the count only.
 */
export async function deleteWindowsEndedBefore(transaction: TenantTransaction, before: Date): Promise<number> {
  const cutoff = z.date().parse(before)
  const deleted = deletedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    delete from app.unavailability_windows where ends_at < ${instant(cutoff)}
  `), 'Unavailability delete failed'))
  return deleted.rowCount
}
