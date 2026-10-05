import type { SQL } from 'drizzle-orm'
import type { RosterAssignment, SetRoster } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { isCalendarDate, RosterInputError } from '../../../../shared'
import { appendAuditEntry } from '../../audit'
import { driverIsInTenant } from '../../drivers'
import { vehiclePresence } from '../../vehicles'

const rosterRowSchema = z.object({
  id: z.uuid(),
  rosterDate: z.string().refine(isCalendarDate),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
})

const rosterRows = z.object({
  rows: z.array(rosterRowSchema),
})

type RosterRow = z.infer<typeof rosterRowSchema>

const assignmentRows = z.object({
  rows: z.array(z.object({
    driverId: z.uuid(),
    vehicleId: z.uuid(),
  })),
})

const idRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/** The Driver or the Vehicle is not in this Tenant. Another Tenant's id looks the same. */
export class RosterNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Not Found')
    this.name = 'RosterNotFoundError'
  }
}

/** That Vehicle is already on another Driver for the same day. The message does not name it. */
export class RosterVehicleTakenError extends Error {
  readonly statusCode = 409
  readonly code = 'roster_vehicle_taken'

  constructor() {
    super('Conflict')
    this.name = 'RosterVehicleTakenError'
  }
}

/** A new assignment cannot use an archived Vehicle. The plate is not in the message. */
export class RosterVehicleArchivedError extends Error {
  readonly statusCode = 409
  readonly code = 'roster_vehicle_archived'

  constructor() {
    super('Conflict')
    this.name = 'RosterVehicleArchivedError'
  }
}

/**
 * This Driver already has a row for the day, usually because two saves raced.
 * The caller reloads. The message does not name the Driver.
 */
export class RosterDriverTakenError extends Error {
  readonly statusCode = 409
  readonly code = 'roster_driver_taken'

  constructor() {
    super('Conflict')
    this.name = 'RosterDriverTakenError'
  }
}

/**
 * The Vehicle id on the roster for this Driver and calendar date.
 * A later Ride assignment (#19) reads this inside its own tenant transaction
 * and may still store a different Vehicle on that one Ride.
 * An archived Vehicle stays here until the office clears or replaces the row.
 * This function does not write, and it does not read a Ride.
 */
export async function vehicleIdForDriverOnDate(
  transaction: TenantTransaction,
  driverId: string,
  rosterDate: string,
): Promise<string | null> {
  if (!isCalendarDate(rosterDate) || !z.uuid().safeParse(driverId).success)
    throw new RosterInputError()
  const selected = z.object({
    rows: z.array(z.object({ vehicleId: z.uuid() })),
  }).parse(await transaction.execute(sql`
    select vehicle_id as "vehicleId"
    from app.roster
    where driver_id = ${driverId}
      and roster_date = cast(${rosterDate} as date)
  `))
  return selected.rows[0]?.vehicleId ?? null
}

/** This Tenant's assignments for one calendar date. The office list joins names elsewhere. */
export async function loadRosterDay(transaction: TenantTransaction, rosterDate: string): Promise<RosterAssignment[]> {
  if (!isCalendarDate(rosterDate))
    throw new RosterInputError()
  const selected = assignmentRows.parse(await transaction.execute(sql`
    select driver_id as "driverId", vehicle_id as "vehicleId"
    from app.roster
    where roster_date = cast(${rosterDate} as date)
    order by driver_id
  `))
  return selected.rows
}

/**
 * Give a Driver a Vehicle for one calendar date, or clear that day when
 * `vehicleId` is null. The same pair again writes nothing.
 * A roster write never updates a Ride: this module has no ride table, so a
 * later assignment keeps the Vehicle it stored.
 */
export async function setRosterVehicle(
  transaction: TenantTransaction,
  actorUserId: string,
  input: SetRoster,
): Promise<RosterAssignment | null> {
  if (!await driverIsInTenant(transaction, input.driverId))
    throw new RosterNotFoundError()

  const current = await lockDriverDay(transaction, input.rosterDate, input.driverId)
  if (input.vehicleId === null)
    return clearRoster(transaction, actorUserId, current)

  // Re-saving the same pair is not a new write, so a Vehicle archived later still matches.
  if (current !== null && current.vehicleId === input.vehicleId)
    return { driverId: current.driverId, vehicleId: current.vehicleId }

  const presence = await vehiclePresence(transaction, input.vehicleId)
  if (presence === 'missing')
    throw new RosterNotFoundError()
  if (presence === 'archived')
    throw new RosterVehicleArchivedError()
  if (await vehicleDayTaken(transaction, input.rosterDate, input.vehicleId, input.driverId))
    throw new RosterVehicleTakenError()

  const row = current
    ? await updateRoster(transaction, current, input.vehicleId)
    : await insertRoster(transaction, input)

  await appendAuditEntry(transaction, current
    ? {
        action: 'roster.changed',
        actorUserId,
        subjectUserId: null,
        data: {
          rosterDate: input.rosterDate,
          driverId: input.driverId,
          fromVehicleId: current.vehicleId,
          toVehicleId: input.vehicleId,
        },
      }
    : {
        action: 'roster.assigned',
        actorUserId,
        subjectUserId: null,
        data: {
          rosterDate: input.rosterDate,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
        },
      })

  return { driverId: row.driverId, vehicleId: row.vehicleId }
}

async function clearRoster(
  transaction: TenantTransaction,
  actorUserId: string,
  current: RosterRow | null,
): Promise<null> {
  if (!current)
    return null
  await deleteRoster(transaction, current.id)
  await appendAuditEntry(transaction, {
    action: 'roster.cleared',
    actorUserId,
    subjectUserId: null,
    data: {
      rosterDate: current.rosterDate,
      driverId: current.driverId,
      vehicleId: current.vehicleId,
    },
  })
  return null
}

async function lockDriverDay(
  transaction: TenantTransaction,
  rosterDate: string,
  driverId: string,
): Promise<RosterRow | null> {
  const selected = rosterRows.parse(await transaction.execute(sql`
    select id,
           roster_date::text as "rosterDate",
           driver_id as "driverId",
           vehicle_id as "vehicleId"
    from app.roster
    where roster_date = cast(${rosterDate} as date)
      and driver_id = ${driverId}
    for update
  `))
  return selected.rows[0] ?? null
}

async function vehicleDayTaken(
  transaction: TenantTransaction,
  rosterDate: string,
  vehicleId: string,
  driverId: string,
): Promise<boolean> {
  const selected = idRows.parse(await transaction.execute(sql`
    select id
    from app.roster
    where roster_date = cast(${rosterDate} as date)
      and vehicle_id = ${vehicleId}
      and driver_id <> ${driverId}
    for update
  `))
  return selected.rows.length > 0
}

async function insertRoster(transaction: TenantTransaction, input: SetRoster): Promise<RosterRow> {
  const selected = rosterRows.parse(await runRoster(transaction, sql`
    insert into app.roster (roster_date, driver_id, vehicle_id)
    values (cast(${input.rosterDate} as date), ${input.driverId}, ${input.vehicleId})
    returning id,
              roster_date::text as "rosterDate",
              driver_id as "driverId",
              vehicle_id as "vehicleId"
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Roster insert returned no row.')
  return row
}

async function updateRoster(transaction: TenantTransaction, current: RosterRow, vehicleId: string): Promise<RosterRow> {
  const selected = rosterRows.parse(await runRoster(transaction, sql`
    update app.roster
    set vehicle_id = ${vehicleId}
    where id = ${current.id}
    returning id,
              roster_date::text as "rosterDate",
              driver_id as "driverId",
              vehicle_id as "vehicleId"
  `))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Roster update returned no row.')
  return row
}

async function deleteRoster(transaction: TenantTransaction, id: string): Promise<void> {
  const selected = idRows.parse(await runRoster(transaction, sql`
    delete from app.roster
    where id = ${id}
    returning id
  `))
  if (!selected.rows[0])
    throw new Error('Roster delete returned no row.')
}

/**
 * Run one insert, update, or delete. A duplicate day is a conflict.
 * Every other failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown.
 */
async function runRoster(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch (error) {
    const index = rosterUniqueIndex(error)
    if (index === 'roster_vehicle_day')
      throw new RosterVehicleTakenError()
    if (index === 'roster_driver_day')
      throw new RosterDriverTakenError()
    throw new Error('Roster write failed')
  }
}

/**
 * Drizzle wraps the Postgres error. The outer message includes the bound
 * ids, so it is never rethrown. Only the two day indexes are conflicts.
 */
function rosterUniqueIndex(error: unknown): 'roster_vehicle_day' | 'roster_driver_day' | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = 'code' in current ? current.code : undefined
    const constraint = 'constraint' in current && typeof current.constraint === 'string' ? current.constraint : ''
    const message = 'message' in current && typeof current.message === 'string' ? current.message : ''
    if (code === '23505') {
      if (constraint === 'roster_vehicle_day' || message.includes('roster_vehicle_day'))
        return 'roster_vehicle_day'
      if (constraint === 'roster_driver_day' || message.includes('roster_driver_day'))
        return 'roster_driver_day'
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return null
}
