import { z } from 'zod'
import { addCalendarDays, isCalendarDate } from './date'

/**
 * A roster day is a calendar date, `YYYY-MM-DD`, with no time and no zone.
 * The Tenant time zone is used only to decide which day "today" is.
 */
export const rosterDateSchema = z.string().refine(isCalendarDate)

const driverIdSchema = z.uuid()
const vehicleIdSchema = z.uuid()

/** One Driver's Vehicle on one day. The plate and the name stay off this object. */
export const rosterAssignmentSchema = z.object({
  driverId: driverIdSchema,
  vehicleId: vehicleIdSchema,
})

export type RosterAssignment = z.infer<typeof rosterAssignmentSchema>

/** GET /api/roster?date=. An empty list is a day with no assignments. */
export const rosterDaySchema = z.object({
  rosterDate: rosterDateSchema,
  assignments: z.array(rosterAssignmentSchema),
})

export type RosterDay = z.infer<typeof rosterDaySchema>

/**
 * PUT /api/roster. `vehicleId` null clears that Driver's row for the day.
 * An unknown key is refused, so a plate or a name cannot ride along.
 */
export const setRosterSchema = z.strictObject({
  rosterDate: rosterDateSchema,
  driverId: driverIdSchema,
  vehicleId: vehicleIdSchema.nullable(),
})

export type SetRoster = z.infer<typeof setRosterSchema>

/** PUT /api/roster. Null is a day that no longer has a row for that Driver. */
export const setRosterResultSchema = z.object({
  assignment: rosterAssignmentSchema.nullable(),
})

export type SetRosterResult = z.infer<typeof setRosterResultSchema>

/** The body or the date query was not a roster day. Nothing is written. */
export class RosterInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'RosterInputError'
  }
}

/** The `date` query. Anything but one calendar date is refused before a session opens. */
export function parseRosterDate(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw))
    throw new RosterInputError()
  return raw
}

/** Accepts one assignment or a clear. Any other body throws first, so the caller does not open a session. */
export function parseSetRoster(raw: unknown): SetRoster {
  const parsed = setRosterSchema.safeParse(raw)
  if (!parsed.success)
    throw new RosterInputError()
  return parsed.data
}

export type RosterCopySkipReason = 'archivedVehicle' | 'vehicleGiven'

export interface RosterCopyCell {
  readonly driverId: string
  readonly rosterDate: string
  readonly vehicleId: string
}

export interface RosterCopySkip extends RosterCopyCell {
  readonly reason: RosterCopySkipReason
}

export interface RosterCopyPlan {
  readonly writes: readonly RosterCopyCell[]
  readonly skipped: readonly RosterCopySkip[]
}

/**
 * Fills empty cells from the same weekday last week. A filled cell stays.
 * An archived Vehicle, or one already given that day, is skipped.
 */
export function planRosterCopy(input: {
  readonly driverIds: readonly string[]
  readonly thisWeekDates: readonly string[]
  readonly lastWeek: readonly RosterCopyCell[]
  readonly thisWeek: readonly RosterCopyCell[]
  readonly archivedVehicleIds: readonly string[]
}): RosterCopyPlan {
  const filled = new Set(input.thisWeek.map(cell => `${cell.driverId}:${cell.rosterDate}`))
  const givenByDay = new Map<string, Set<string>>()
  for (const cell of input.thisWeek) {
    const given = givenByDay.get(cell.rosterDate) ?? new Set<string>()
    given.add(cell.vehicleId)
    givenByDay.set(cell.rosterDate, given)
  }
  const lastByCell = new Map<string, string>()
  for (const cell of input.lastWeek)
    lastByCell.set(`${cell.driverId}:${cell.rosterDate}`, cell.vehicleId)
  const archived = new Set(input.archivedVehicleIds)

  const writes: RosterCopyCell[] = []
  const skipped: RosterCopySkip[] = []

  for (const driverId of input.driverIds) {
    for (const rosterDate of input.thisWeekDates) {
      if (filled.has(`${driverId}:${rosterDate}`))
        continue
      const vehicleId = lastByCell.get(`${driverId}:${addCalendarDays(rosterDate, -7)}`)
      if (!vehicleId)
        continue
      if (archived.has(vehicleId)) {
        skipped.push({ driverId, rosterDate, vehicleId, reason: 'archivedVehicle' })
        continue
      }
      const given = givenByDay.get(rosterDate) ?? new Set<string>()
      if (given.has(vehicleId)) {
        skipped.push({ driverId, rosterDate, vehicleId, reason: 'vehicleGiven' })
        continue
      }
      writes.push({ driverId, rosterDate, vehicleId })
      given.add(vehicleId)
      givenByDay.set(rosterDate, given)
    }
  }

  return { writes, skipped }
}
